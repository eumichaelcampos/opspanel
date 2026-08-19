import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { UserSecretKind } from "@opspanel/database";
import { loadEnv } from "@opspanel/config";
import { decryptJson, encryptJson } from "@opspanel/security";
import { PrismaService } from "../prisma/prisma.service";

function maskOpenAiKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length < 12) return "sk-****";
  return `${trimmed.slice(0, 7)}…${trimmed.slice(-4)}`;
}

@Injectable()
export class UserSecretsService {
  constructor(private readonly prisma: PrismaService) {}

  private encryptionKey() {
    return loadEnv().CREDENTIALS_ENCRYPTION_KEY;
  }

  async getOpenAiStatus(userId: string) {
    const row = await this.prisma.client.userSecret.findUnique({
      where: { userId_kind: { userId, kind: UserSecretKind.openai_api_key } },
    });
    if (!row) {
      return { connected: false as const, hint: null, updatedAt: null };
    }
    return {
      connected: true as const,
      hint: row.hint,
      updatedAt: row.updatedAt,
      label: row.label,
    };
  }

  async getOpenAiApiKey(userId: string): Promise<string | null> {
    const row = await this.prisma.client.userSecret.findUnique({
      where: { userId_kind: { userId, kind: UserSecretKind.openai_api_key } },
    });
    if (!row) return null;
    try {
      const payload = decryptJson<{ apiKey: string }>(
        {
          ciphertext: row.ciphertext,
          iv: row.iv,
          authTag: row.authTag,
          keyVersion: row.keyVersion,
        },
        this.encryptionKey(),
      );
      return payload.apiKey?.trim() || null;
    } catch {
      return null;
    }
  }

  async upsertOpenAiApiKey(userId: string, apiKey: string, label?: string) {
    const trimmed = apiKey.trim();
    if (!trimmed.startsWith("sk-") || trimmed.length < 20) {
      throw new BadRequestException({
        error: { code: "VALIDATION_ERROR", message: "Chave OpenAI inválida. Use uma key que comece com sk-." },
      });
    }

    const test = await this.testOpenAiKey(trimmed);
    if (!test.ok) {
      throw new BadRequestException({
        error: { code: "OPENAI_KEY_INVALID", message: test.message ?? "Não foi possível validar a chave na OpenAI." },
      });
    }

    const enc = encryptJson({ apiKey: trimmed }, this.encryptionKey());
    const hint = maskOpenAiKey(trimmed);

    await this.prisma.client.userSecret.upsert({
      where: { userId_kind: { userId, kind: UserSecretKind.openai_api_key } },
      create: {
        userId,
        kind: UserSecretKind.openai_api_key,
        label: label?.trim() || "OpenAI",
        hint,
        ciphertext: enc.ciphertext,
        iv: enc.iv,
        authTag: enc.authTag,
        keyVersion: enc.keyVersion,
      },
      update: {
        label: label?.trim() || "OpenAI",
        hint,
        ciphertext: enc.ciphertext,
        iv: enc.iv,
        authTag: enc.authTag,
        keyVersion: enc.keyVersion,
      },
    });

    return { connected: true, hint, model: test.model };
  }

  async deleteOpenAiApiKey(userId: string) {
    const existing = await this.prisma.client.userSecret.findUnique({
      where: { userId_kind: { userId, kind: UserSecretKind.openai_api_key } },
    });
    if (!existing) {
      throw new NotFoundException({
        error: { code: "NOT_FOUND", message: "Nenhuma chave OpenAI conectada." },
      });
    }
    await this.prisma.client.userSecret.delete({ where: { id: existing.id } });
    return { connected: false };
  }

  async testOpenAiKey(apiKey: string): Promise<{ ok: boolean; message?: string; model?: string }> {
    try {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: "Chave rejeitada pela OpenAI (401/403)." };
      }
      if (!res.ok) {
        return { ok: false, message: `OpenAI retornou HTTP ${res.status}.` };
      }
      const preferred = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
      return { ok: true, model: preferred };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "Falha ao contatar OpenAI." };
    }
  }
}
