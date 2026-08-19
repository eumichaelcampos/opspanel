import { BadRequestException, Injectable } from "@nestjs/common";
import { OrgRole } from "@opspanel/database";
import { siteCreateInputSchema } from "@opspanel/contracts";
import { SessionUser } from "../auth/auth.guard";
import { CodexOAuthService } from "../codex/codex-oauth.service";
import { DashboardService } from "../dashboard/dashboard.service";
import { QuotasService } from "../license/quotas.service";
import { PrismaService } from "../prisma/prisma.service";
import { SitesService } from "../sites/sites.service";
import { UserSecretsService } from "../user-secrets/user-secrets.service";
import { LicenseService } from "../license/license.service";
export type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

type ToolResult = { tool: string; data: unknown };

@Injectable()
export class AssistantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboard: DashboardService,
    private readonly sites: SitesService,
    private readonly quotas: QuotasService,
    private readonly userSecrets: UserSecretsService,
    private readonly license: LicenseService,
    private readonly codex: CodexOAuthService,
  ) {}

  private assertWrite(user: SessionUser) {
    if (user.role === OrgRole.viewer) {
      throw new BadRequestException({ error: { code: "FORBIDDEN", message: "Permissão insuficiente." } });
    }
  }

  async chat(user: SessionUser, messages: ChatMessage[], ip?: string) {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const text = (lastUser?.content ?? "").trim();
    if (!text) {
      throw new BadRequestException({ error: { code: "VALIDATION_ERROR", message: "Mensagem vazia." } });
    }

    const userOpenAiKey = await this.userSecrets.getOpenAiApiKey(user.id);
    const codexStatus = await this.codex.getStatus(user.id);
    const entitlements = await this.license.getEntitlements();
    const platformKey = process.env.OPENAI_API_KEY;
    const toolResults: ToolResult[] = [];
    const lower = text.toLowerCase();
    if (/listar\s+(servidores|servers)/.test(lower) || /quais\s+servidores/.test(lower)) {
      toolResults.push({ tool: "list_servers", data: await this.listServers(user) });
    }
    if (/listar\s+sites/.test(lower) || /quais\s+sites/.test(lower)) {
      toolResults.push({ tool: "list_sites", data: await this.listSites(user) });
    }
    if (/status|resumo|dashboard|visão geral/.test(lower)) {
      toolResults.push({ tool: "dashboard", data: await this.dashboard.getOverview(user) });
    }

    const createMatch = text.match(
      /cri(?:ar|e)\s+(?:um\s+)?site(?:\s+(?:wp|wordpress|html|php|mysql))?(?:\s+(?:no|em|para)\s+(?:servidor\s+)?["']?([^"'\s,]+)["']?)?(?:\s+(?:domínio|dominio|domain)\s+["']?([a-z0-9.-]+\.[a-z]{2,})["']?)?/i,
    );
    const domainFromText = createMatch?.[2] ?? text.match(/([a-z0-9-]+\.[a-z0-9.-]+\.[a-z]{2,})/i)?.[1];
    const serverHint = createMatch?.[1];

    if (/cri(?:ar|e)\s+(?:um\s+)?site/.test(lower) && domainFromText) {
      this.assertWrite(user);
      const siteType = /wordpress|\bwp\b/.test(lower) ? "wp" : /html/.test(lower) ? "html" : /php/.test(lower) ? "php" : "wp";
      const servers = await this.listServers(user);
      const server =
        servers.find((s) => s.name.toLowerCase() === serverHint?.toLowerCase()) ??
        servers.find((s) => s.host.includes(serverHint ?? "")) ??
        servers[0];

      if (!server) {
        toolResults.push({ tool: "create_site", data: { error: "Nenhum servidor disponível." } });
      } else {
        const payload = {
          serverId: server.id,
          domain: domainFromText.toLowerCase(),
          siteType,
          sslMode: /ssl|https|letsencrypt/.test(lower) ? ("letsencrypt" as const) : ("none" as const),
        };
        const parsed = siteCreateInputSchema.safeParse(payload);
        if (!parsed.success) {
          toolResults.push({ tool: "create_site", data: { error: "Dados inválidos para criar site.", details: parsed.error.flatten() } });
        } else {
          const result = await this.sites.create(user, parsed.data, ip);
          toolResults.push({ tool: "create_site", data: { ...result, domain: parsed.data.domain, serverName: server.name } });
        }
      }
    }

    const openAiKey = userOpenAiKey || (entitlements.aiAssistant ? platformKey : undefined);
    if (openAiKey) {
      const result = await this.replyWithOpenAi(text, messages, toolResults, openAiKey);
      await this.quotas.incrementMetric("ai_calls");
      return {
        ...result,
        provider: userOpenAiKey ? "user_byok" : "platform",
      };
    }

    if (codexStatus.connected) {
      try {
        const result = await this.replyWithCodex(user.id, text, messages, toolResults);
        await this.quotas.incrementMetric("ai_calls");
        return {
          ...result,
          provider: "chatgpt_codex" as const,
        };
      } catch {
        // fall through to local mode
      }
    }

    await this.quotas.incrementMetric("ai_calls");
    return {
      reply: this.replyRuleBased(text, toolResults),
      toolResults,
      provider: "local" as const,
      hint: codexStatus.connected
        ? "ChatGPT indisponível no momento; usando modo local."
        : "Conecte ChatGPT (assinatura) ou sua API key OpenAI em Conta & API para respostas com GPT.",
    };
  }
  private async listServers(user: SessionUser) {
    return this.prisma.client.server.findMany({
      where: { organizationId: user.organizationId, deletedAt: null },
      select: { id: true, name: true, host: true, status: true, wordopsVersion: true },
      orderBy: { name: "asc" },
    });
  }

  private async listSites(user: SessionUser) {
    return this.prisma.client.site.findMany({
      where: {
        organizationId: user.organizationId,
        deletedAt: null,
        server: { deletedAt: null },
      },
      select: { id: true, domain: true, status: true, server: { select: { name: true } } },
      orderBy: { domain: "asc" },
      take: 50,
    });
  }

  private replyRuleBased(text: string, toolResults: ToolResult[]): string {
    const lower = text.toLowerCase();
    if (toolResults.length === 0) {
      return [
        "Sou o assistente OpsPanel. Posso ajudar com:",
        "",
        "• **Listar servidores** ou **listar sites**",
        "• **Status** ou **resumo** da plataforma",
        "• **Criar site** (ex: \"criar site wp no servidor SRV-TALLES domínio exemplo.com\")",
        "",
        "Para integração com Cursor ou Claude Desktop, gere uma API key em Configurações da conta e use o MCP server `@opspanel/mcp-server`.",
      ].join("\n");
    }

    const parts: string[] = [];
    for (const tr of toolResults) {
      if (tr.tool === "list_servers") {
        const servers = tr.data as Awaited<ReturnType<AssistantService["listServers"]>>;
        parts.push(
          servers.length
            ? `**Servidores (${servers.length}):**\n${servers.map((s) => `• ${s.name} (${s.host}) — ${s.status}`).join("\n")}`
            : "Nenhum servidor cadastrado.",
        );
      }
      if (tr.tool === "list_sites") {
        const sites = tr.data as Awaited<ReturnType<AssistantService["listSites"]>>;
        parts.push(
          sites.length
            ? `**Sites (${sites.length}):**\n${sites.map((s) => `• ${s.domain} — ${s.server.name} (${s.status})`).join("\n")}`
            : "Nenhum site no inventário.",
        );
      }
      if (tr.tool === "dashboard") {
        const d = tr.data as Awaited<ReturnType<DashboardService["getOverview"]>>;
        parts.push(
          `**Resumo:** ${d.stats.servers} servidores (${d.stats.serversHealthy} saudáveis), ${d.stats.sites} sites, ${d.stats.jobsRunning} jobs em execução, ${d.stats.jobsFailed24h} falhas nas últimas 24h.`,
        );
      }
      if (tr.tool === "create_site") {
        const r = tr.data as { jobId?: string; domain?: string; serverName?: string; error?: string };
        if (r.error) {
          parts.push(`Não foi possível criar o site: ${r.error}`);
        } else {
          parts.push(
            `Job de criação iniciado para **${r.domain}** no servidor **${r.serverName}**. Acompanhe em Jobs (ID: \`${r.jobId}\`).`,
          );
        }
      }
    }

    if (/obrigad|valeu|thanks/.test(lower)) {
      parts.push("Por nada! Estou à disposição.");
    }

    return parts.join("\n\n");
  }

  private buildSystemPrompt(toolResults: ToolResult[]) {
    const contextBlock =
      toolResults.length > 0
        ? `\n\nResultados das ferramentas:\n${JSON.stringify(toolResults, null, 2)}`
        : "";
    return `Você é o assistente OpsPanel, control plane WordOps. Responda em português, de forma concisa. Use os resultados das ferramentas quando disponíveis. Nunca invente IDs ou domínios.${contextBlock}`;
  }

  private async replyWithCodex(
    userId: string,
    text: string,
    messages: ChatMessage[],
    toolResults: ToolResult[],
  ) {
    const system = this.buildSystemPrompt(toolResults);
    const reply =
      (await this.codex.chatCompletion(userId, system, [
        ...messages.slice(-10),
        ...(toolResults.length ? [{ role: "user", content: `Contexto adicional:\n${JSON.stringify(toolResults, null, 2)}` }] : []),
      ])) ?? this.replyRuleBased(text, toolResults);
    return { reply, toolResults };
  }

  private async replyWithOpenAi(    text: string,
    messages: ChatMessage[],
    toolResults: ToolResult[],
    apiKey: string,
  ) {
    const system = this.buildSystemPrompt(toolResults);

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        messages: [
          { role: "system", content: system },
          ...messages.slice(-10).map((m) => ({ role: m.role, content: m.content })),
        ],
        temperature: 0.3,
        max_tokens: 800,
      }),
    });
    if (!res.ok) {
      return { reply: this.replyRuleBased(text, toolResults), toolResults, aiError: "OpenAI indisponível, usando modo local." };
    }

    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const reply = json.choices?.[0]?.message?.content ?? this.replyRuleBased(text, toolResults);
    return { reply, toolResults };
  }
}
