import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { loadEnv } from "@opspanel/config";
import type { FastifyRequest } from "fastify";
import { AuthGuard } from "../auth/auth.guard";

const MANAGE_ACTIONS = [
  "enable",
  "disable",
  "letsencrypt",
  "letsencrypt_dns_cf",
  "update_wpfc",
  "update_wpredis",
  "update_wprocket",
  "update_wpsc",
  "update_wpce",
  "update_php81",
  "update_php82",
  "update_php83",
  "update_php84",
] as const;

function buildOpenApi(serverUrl: string) {
  const uuidParam = (name: string, description: string) => ({
    name,
    in: "path" as const,
    required: true,
    schema: { type: "string", format: "uuid" },
    description,
  });

  return {
    openapi: "3.1.0",
    info: {
      title: "OpsPanel",
      description:
        "Control plane WordOps para Custom GPT. Autentique com API Key Bearer (opk_…). O usuário usa o ChatGPT dele; as ações executam no OpsPanel.",
      version: "1.1.0",
    },
    servers: [{ url: serverUrl }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "API key OpsPanel (opk_…)",
        },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      "/servers": {
        get: {
          operationId: "listServers",
          summary: "Listar servidores WordOps",
          responses: { "200": { description: "OK" } },
        },
      },
      "/servers/{serverId}/sync": {
        post: {
          operationId: "syncServer",
          summary: "Sincronizar inventário do servidor",
          parameters: [uuidParam("serverId", "ID do servidor")],
          responses: { "200": { description: "Job criado" } },
        },
      },
      "/servers/{serverId}/health": {
        post: {
          operationId: "checkServerHealth",
          summary: "Verificar saúde do servidor",
          parameters: [uuidParam("serverId", "ID do servidor")],
          responses: { "200": { description: "Job criado" } },
        },
      },
      "/sites": {
        get: {
          operationId: "listSites",
          summary: "Listar sites",
          parameters: [
            {
              name: "serverId",
              in: "query",
              schema: { type: "string", format: "uuid" },
              required: false,
            },
          ],
          responses: { "200": { description: "OK" } },
        },
        post: {
          operationId: "createSite",
          summary: "Criar site WordOps",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["serverId", "domain", "siteType"],
                  properties: {
                    serverId: { type: "string", format: "uuid" },
                    domain: { type: "string" },
                    siteType: { type: "string", default: "wp", enum: ["wp", "html", "php", "mysql"] },
                    sslMode: { type: "string", enum: ["none", "letsencrypt", "selfsigned"] },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Job criado" } },
        },
      },
      "/sites/{siteId}": {
        get: {
          operationId: "getSite",
          summary: "Detalhes de um site",
          parameters: [uuidParam("siteId", "ID do site")],
          responses: { "200": { description: "OK" } },
        },
      },
      "/sites/{siteId}/info": {
        post: {
          operationId: "refreshSiteInfo",
          summary: "Atualizar inventário do site no servidor",
          parameters: [uuidParam("siteId", "ID do site")],
          responses: { "200": { description: "Job criado" } },
        },
      },
      "/sites/{siteId}/manage": {
        post: {
          operationId: "manageSite",
          summary: "Gerenciar site (ligar/desligar, SSL, cache, PHP)",
          parameters: [uuidParam("siteId", "ID do site")],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["action"],
                  properties: {
                    action: { type: "string", enum: [...MANAGE_ACTIONS] },
                    cloudflareApiKey: { type: "string" },
                    cloudflareEmail: { type: "string" },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Job criado" } },
        },
      },
      "/sites/{siteId}/backup": {
        post: {
          operationId: "backupSite",
          summary: "Gerar backup do site",
          parameters: [uuidParam("siteId", "ID do site")],
          responses: { "200": { description: "Job criado" } },
        },
      },
      "/sites/{siteId}/dns": {
        get: {
          operationId: "checkSiteDns",
          summary: "Verificar DNS do domínio",
          parameters: [uuidParam("siteId", "ID do site")],
          responses: { "200": { description: "OK" } },
        },
      },
      "/sites/{siteId}/ftp-users": {
        post: {
          operationId: "createFtpUser",
          summary: "Criar usuário FTP no site",
          parameters: [uuidParam("siteId", "ID do site")],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["username"],
                  properties: {
                    username: { type: "string" },
                    password: { type: "string" },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Job criado" } },
        },
      },
      "/dashboard/overview": {
        get: {
          operationId: "getDashboard",
          summary: "Resumo da plataforma",
          responses: { "200": { description: "OK" } },
        },
      },
      "/jobs": {
        get: {
          operationId: "listJobs",
          summary: "Listar jobs recentes",
          responses: { "200": { description: "OK" } },
        },
      },
      "/jobs/{jobId}": {
        get: {
          operationId: "getJob",
          summary: "Status de um job",
          parameters: [uuidParam("jobId", "ID do job")],
          responses: { "200": { description: "OK" } },
        },
      },
      "/assistant/chat": {
        post: {
          operationId: "assistantChat",
          summary: "Assistente OpsPanel",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["messages"],
                  properties: {
                    messages: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          role: { type: "string" },
                          content: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Resposta" } },
        },
      },
    },
  };
}

const GPT_INSTRUCTIONS = `Você é o OpsPanel Agent, operador de infraestrutura WordOps.

## Papel
Ajude o usuário a gerenciar servidores e sites WordOps via Actions. Responda sempre em português, de forma clara para quem não é técnico.

## Fluxo
1. Quando o usuário pedir algo, primeiro liste servidores ou sites se não souber o ID.
2. Antes de ações destrutivas (excluir, desligar site), confirme com o usuário.
3. Após criar jobs (criar site, backup, manage), informe o jobId e diga para acompanhar em Jobs.

## Ações disponíveis
- listServers / listSites / getSite / getDashboard
- createSite (serverId, domain, siteType wp|html|php)
- manageSite (enable, disable, letsencrypt, update_wprocket, update_php83, etc.)
- backupSite, refreshSiteInfo, checkSiteDns
- syncServer, checkServerHealth
- listJobs / getJob para acompanhar execução

## Regras
- Nunca invente IDs, domínios ou status.
- Se faltar informação (servidor, domínio, ação), pergunte.
- Para SSL com Cloudflare DNS use action letsencrypt_dns_cf (requer credenciais CF no body).
- Prefira nomes legíveis (domínio, nome do servidor) nas respostas, mas use IDs nas chamadas API.`;

/**
 * Integração ChatGPT: Custom GPT Actions (OpenAPI) + guia de conexão.
 * O usuário conversa no ChatGPT da conta dele; Actions chamam o OpsPanel com API key.
 */
@Controller("chatgpt")
export class ChatGptController {
  @Get("openapi.json")
  openApi(@Req() req: FastifyRequest) {
    const env = loadEnv();
    const proto = (req.headers["x-forwarded-proto"] as string) || "http";
    const host = (req.headers["x-forwarded-host"] as string) || req.headers.host || "localhost:3001";
    const fallback = `${proto}://${host}`.replace(/\/$/, "");
    const apiRoot = (env.API_URL || fallback).replace(/\/$/, "");
    const serverUrl = apiRoot.endsWith("/api/v1") ? apiRoot : `${apiRoot}/api/v1`;
    return buildOpenApi(serverUrl);
  }

  @Get("connect")
  @UseGuards(AuthGuard)
  connectInfo() {
    const env = loadEnv();
    const apiRoot = env.API_URL.replace(/\/$/, "");
    const openapiUrl = `${apiRoot}/api/v1/chatgpt/openapi.json`;
    return {
      openapiUrl,
      auth: "Bearer API key OpsPanel (opk_…)",
      gptInstructions: GPT_INSTRUCTIONS,
      instructions: [
        "Gere uma API key OpsPanel abaixo (ex: ChatGPT Actions).",
        "No ChatGPT, abra o editor de Custom GPT (Create → Configure).",
        "Em Actions → Create new action → Import from URL e cole a URL OpenAPI.",
        "Em Authentication → API Key → Auth Type Bearer; cole a chave opk_… gerada.",
        "Em Instructions, cole o texto pronto disponível nesta página.",
        "Salve o GPT. Você usa o ChatGPT da sua assinatura; o OpsPanel só recebe chamadas autenticadas.",
      ],
      mcpStdioHint:
        "Para Cursor/Claude Desktop, use o MCP stdio @opspanel/mcp-server com a mesma API key.",
    };
  }
}
