import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { UserSecretKind } from "@opspanel/database";
import { decryptJson, encryptJson } from "@opspanel/security";
import { loadEnv } from "@opspanel/config";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const ISSUER = "https://auth.openai.com";
const CODEX_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";
const DEFAULT_MODEL = process.env.CODEX_MODEL ?? "gpt-5.3-codex";
const USER_AGENT = "opspanel/1.0";

type TokenResponse = {
  id_token?: string;
  access_token: string;
  refresh_token: string;
  expires_in?: number;
};

type StoredCodexAuth = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountId?: string;
};

type PendingFlow = {
  userId: string;
  deviceAuthId: string;
  userCode: string;
  intervalMs: number;
  createdAt: number;
};

function parseJwtClaims(token: string): Record<string, unknown> | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  try {
    return JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function extractAccountId(tokens: TokenResponse): string | undefined {
  for (const token of [tokens.id_token, tokens.access_token]) {
    if (!token) continue;
    const claims = parseJwtClaims(token);
    if (!claims) continue;
    const auth = claims["https://api.openai.com/auth"] as { chatgpt_account_id?: string } | undefined;
    const orgs = claims.organizations as Array<{ id: string }> | undefined;
    const accountId =
      (claims.chatgpt_account_id as string | undefined) ||
      auth?.chatgpt_account_id ||
      orgs?.[0]?.id;
    if (accountId) return accountId;
  }
  return undefined;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class CodexOAuthService {
  private readonly pending = new Map<string, PendingFlow>();

  constructor(private readonly prisma: PrismaService) {}

  private encryptionKey() {
    return loadEnv().CREDENTIALS_ENCRYPTION_KEY;
  }

  async getStatus(userId: string) {
    const row = await this.prisma.client.userSecret.findUnique({
      where: { userId_kind: { userId, kind: UserSecretKind.openai_codex_oauth } },
    });
    if (!row) {
      return { connected: false as const, hint: null, updatedAt: null, model: DEFAULT_MODEL };
    }
    return {
      connected: true as const,
      hint: row.hint ?? "ChatGPT (Codex OAuth)",
      updatedAt: row.updatedAt,
      model: DEFAULT_MODEL,
    };
  }

  async startDeviceFlow(userId: string) {
    const res = await fetch(`${ISSUER}/api/accounts/deviceauth/usercode`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify({ client_id: CLIENT_ID }),
    });
    if (!res.ok) {
      throw new ServiceUnavailableException({
        error: { code: "CODEX_AUTH_START_FAILED", message: "Não foi possível iniciar login ChatGPT." },
      });
    }
    const data = (await res.json()) as {
      device_auth_id: string;
      user_code: string;
      interval: string;
    };
    const flowId = randomUUID();
    const intervalMs = Math.max(parseInt(data.interval, 10) || 5, 1) * 1000;
    this.pending.set(flowId, {
      userId,
      deviceAuthId: data.device_auth_id,
      userCode: data.user_code,
      intervalMs,
      createdAt: Date.now(),
    });
    this.cleanupPending();
    return {
      flowId,
      verifyUrl: `${ISSUER}/codex/device`,
      userCode: data.user_code,
      expiresInSec: 300,
    };
  }

  async pollDeviceFlow(userId: string, flowId: string) {
    const flow = this.pending.get(flowId);
    if (!flow || flow.userId !== userId) {
      throw new NotFoundException({
        error: { code: "CODEX_FLOW_NOT_FOUND", message: "Sessão de login expirada. Inicie novamente." },
      });
    }
    if (Date.now() - flow.createdAt > 5 * 60_000) {
      this.pending.delete(flowId);
      throw new BadRequestException({
        error: { code: "CODEX_FLOW_EXPIRED", message: "Tempo esgotado. Inicie o login novamente." },
      });
    }

    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      const poll = await fetch(`${ISSUER}/api/accounts/deviceauth/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": USER_AGENT,
        },
        body: JSON.stringify({
          device_auth_id: flow.deviceAuthId,
          user_code: flow.userCode,
        }),
      });

      if (poll.ok) {
        const data = (await poll.json()) as {
          authorization_code: string;
          code_verifier: string;
        };
        const tokens = await this.exchangeDeviceCode(data.authorization_code, data.code_verifier);
        await this.saveTokens(userId, tokens);
        this.pending.delete(flowId);
        return { connected: true, hint: "ChatGPT (Codex OAuth)", model: DEFAULT_MODEL };
      }

      if (poll.status !== 403 && poll.status !== 404) {
        this.pending.delete(flowId);
        throw new BadRequestException({
          error: { code: "CODEX_AUTH_FAILED", message: `Login ChatGPT falhou (HTTP ${poll.status}).` },
        });
      }

      await sleep(flow.intervalMs + 500);
    }

    return { pending: true as const };
  }

  async disconnect(userId: string) {
    const existing = await this.prisma.client.userSecret.findUnique({
      where: { userId_kind: { userId, kind: UserSecretKind.openai_codex_oauth } },
    });
    if (!existing) {
      throw new NotFoundException({
        error: { code: "NOT_FOUND", message: "ChatGPT não está conectado." },
      });
    }
    await this.prisma.client.userSecret.delete({ where: { id: existing.id } });
    return { connected: false };
  }

  async chatCompletion(
    userId: string,
    system: string,
    messages: { role: string; content: string }[],
  ): Promise<string | null> {
    const auth = await this.loadAuth(userId);
    if (!auth) return null;

    const fresh = await this.ensureFreshToken(userId, auth);
    const input = messages.slice(-10).map((m) => ({
      role: m.role === "assistant" ? "assistant" : m.role === "system" ? "developer" : "user",
      content: [{ type: "input_text", text: m.content }],
    }));

    const res = await fetch(CODEX_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${fresh.accessToken}`,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        originator: "opspanel",
        ...(fresh.accountId ? { "ChatGPT-Account-Id": fresh.accountId } : {}),
        "OpenAI-Beta": "responses=experimental",
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        instructions: system,
        input,
        store: false,
        stream: false,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new ServiceUnavailableException({
        error: {
          code: "CODEX_CHAT_FAILED",
          message: `ChatGPT retornou HTTP ${res.status}${errText ? `: ${errText.slice(0, 200)}` : ""}`,
        },
      });
    }

    const json = (await res.json()) as {
      output_text?: string;
      output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
    };

    if (json.output_text?.trim()) return json.output_text.trim();

    for (const item of json.output ?? []) {
      for (const part of item.content ?? []) {
        if (part.type === "output_text" && part.text?.trim()) return part.text.trim();
      }
    }

    return null;
  }

  private async exchangeDeviceCode(code: string, codeVerifier: string): Promise<TokenResponse> {
    const res = await fetch(`${ISSUER}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: `${ISSUER}/deviceauth/callback`,
        client_id: CLIENT_ID,
        code_verifier: codeVerifier,
      }).toString(),
    });
    if (!res.ok) {
      throw new BadRequestException({
        error: { code: "CODEX_TOKEN_EXCHANGE_FAILED", message: "Falha ao concluir login ChatGPT." },
      });
    }
    return res.json() as Promise<TokenResponse>;
  }

  private async saveTokens(userId: string, tokens: TokenResponse) {
    const accountId = extractAccountId(tokens);
    const payload: StoredCodexAuth = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      accountId,
    };
    const enc = encryptJson(payload, this.encryptionKey());
    await this.prisma.client.userSecret.upsert({
      where: { userId_kind: { userId, kind: UserSecretKind.openai_codex_oauth } },
      create: {
        userId,
        kind: UserSecretKind.openai_codex_oauth,
        label: "ChatGPT Codex",
        hint: "ChatGPT Plus/Pro (OAuth)",
        ciphertext: enc.ciphertext,
        iv: enc.iv,
        authTag: enc.authTag,
        keyVersion: enc.keyVersion,
      },
      update: {
        hint: "ChatGPT Plus/Pro (OAuth)",
        ciphertext: enc.ciphertext,
        iv: enc.iv,
        authTag: enc.authTag,
        keyVersion: enc.keyVersion,
      },
    });
  }

  private async loadAuth(userId: string): Promise<StoredCodexAuth | null> {
    const row = await this.prisma.client.userSecret.findUnique({
      where: { userId_kind: { userId, kind: UserSecretKind.openai_codex_oauth } },
    });
    if (!row) return null;
    try {
      return decryptJson<StoredCodexAuth>(
        {
          ciphertext: row.ciphertext,
          iv: row.iv,
          authTag: row.authTag,
          keyVersion: row.keyVersion,
        },
        this.encryptionKey(),
      );
    } catch {
      return null;
    }
  }

  private async ensureFreshToken(userId: string, auth: StoredCodexAuth): Promise<StoredCodexAuth> {
    if (auth.expiresAt > Date.now() + 60_000) return auth;

    const res = await fetch(`${ISSUER}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: auth.refreshToken,
        client_id: CLIENT_ID,
      }).toString(),
    });
    if (!res.ok) {
      throw new BadRequestException({
        error: { code: "CODEX_TOKEN_EXPIRED", message: "Sessão ChatGPT expirou. Conecte novamente." },
      });
    }
    const tokens = (await res.json()) as TokenResponse;
    const next: StoredCodexAuth = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? auth.refreshToken,
      expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      accountId: extractAccountId(tokens) ?? auth.accountId,
    };
    await this.saveTokens(userId, tokens);
    return next;
  }

  private cleanupPending() {
    const cutoff = Date.now() - 6 * 60_000;
    for (const [id, flow] of this.pending) {
      if (flow.createdAt < cutoff) this.pending.delete(id);
    }
  }
}
