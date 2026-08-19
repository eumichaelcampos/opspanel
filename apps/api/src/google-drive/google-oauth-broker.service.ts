import { BadRequestException, Injectable, NotFoundException, OnModuleDestroy } from "@nestjs/common";
import { Redis } from "ioredis";
import { randomBytes } from "node:crypto";
import {
  googleOAuthBrokerEndpoint,
  isGoogleOAuthBrokerHub,
  loadEnv,
} from "@opspanel/config";
import { decryptJson } from "@opspanel/security";
import { PrismaService } from "../prisma/prisma.service";
import {
  buildGoogleAuthorizeUrl,
  exchangeGoogleCode,
  fetchGoogleEmail,
  generatePkce,
  refreshGoogleAccessToken,
} from "./google-oauth";
import { appendQuery, isAllowedOAuthReturnUrl } from "./google-oauth-broker.util";

type BrokerSession = {
  returnUrl: string;
  codeVerifier: string;
  clientState: string;
};

type BrokerTicket = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  email?: string;
  tokenType?: string;
};

const SESSION_TTL_SEC = 10 * 60;
const TICKET_TTL_SEC = 2 * 60;

@Injectable()
export class GoogleOAuthBrokerService implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor(private readonly prisma: PrismaService) {
    this.redis = new Redis(loadEnv().REDIS_URL, { maxRetriesPerRequest: null });
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }

  isHub() {
    return isGoogleOAuthBrokerHub(loadEnv());
  }

  async hubApp() {
    const env = loadEnv();
    const setup = await this.prisma.client.systemSetupState.upsert({
      where: { id: "default" },
      create: { id: "default" },
      update: {},
    });
    const clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim() || setup.googleDriveClientId?.trim() || "";
    let clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() || "";
    if (
      !clientSecret &&
      setup.googleDriveClientSecretCipher &&
      setup.googleDriveClientSecretIv &&
      setup.googleDriveClientSecretAuthTag
    ) {
      try {
        const payload = decryptJson<{ clientSecret?: string }>(
          {
            ciphertext: setup.googleDriveClientSecretCipher,
            iv: setup.googleDriveClientSecretIv,
            authTag: setup.googleDriveClientSecretAuthTag,
            keyVersion: 1,
          },
          env.CREDENTIALS_ENCRYPTION_KEY,
        );
        clientSecret = payload.clientSecret?.trim() || "";
      } catch {
        clientSecret = "";
      }
    }
    const publicUrl = (env.GOOGLE_OAUTH_BROKER_PUBLIC_URL || env.WEB_URL).replace(/\/$/, "");
    return {
      clientId,
      clientSecret,
      configured: Boolean(clientId && clientSecret),
      publicUrl,
      redirectUri: googleOAuthBrokerEndpoint(publicUrl, "callback"),
    };
  }

  private assertHub() {
    if (!this.isHub()) {
      throw new NotFoundException({
        error: { code: "GOOGLE_OAUTH_BROKER_DISABLED", message: "OAuth central não está ativo nesta instância." },
      });
    }
  }

  async start(input: { returnUrl?: string; clientState?: string }): Promise<string> {
    this.assertHub();
    const app = await this.hubApp();
    if (!app.configured) {
      throw new BadRequestException({
        error: {
          code: "GOOGLE_OAUTH_NOT_CONFIGURED",
          message: "O hub OAuth ainda não tem Client ID/Secret do Google.",
        },
      });
    }
    const returnUrl = input.returnUrl?.trim() || "";
    if (!isAllowedOAuthReturnUrl(returnUrl)) {
      throw new BadRequestException({
        error: {
          code: "INVALID_RETURN_URL",
          message: "URL de retorno inválida. Use o callback da instalação OpsPanel.",
        },
      });
    }
    if (!input.clientState?.trim()) {
      throw new BadRequestException({
        error: { code: "INVALID_STATE", message: "Sessão OAuth da instalação está incompleta." },
      });
    }
    const { codeVerifier, codeChallenge } = generatePkce();
    const state = randomBytes(24).toString("hex");
    const session: BrokerSession = {
      returnUrl,
      codeVerifier,
      clientState: input.clientState.trim(),
    };
    await this.redis.set(`opspanel:gdrive:oauth:sess:${state}`, JSON.stringify(session), "EX", SESSION_TTL_SEC);
    return buildGoogleAuthorizeUrl({
      clientId: app.clientId,
      redirectUri: app.redirectUri,
      state,
      codeChallenge,
    });
  }

  async callback(input: {
    code?: string;
    state?: string;
    error?: string;
    error_description?: string;
  }): Promise<{ redirectTo: string }> {
    this.assertHub();
    const fallback = (await this.hubApp()).publicUrl;
    const failUnknown = (message: string) => ({ redirectTo: `${fallback}?google=error&message=${encodeURIComponent(message)}` });
    if (!input.state) return failUnknown(input.error_description || input.error || "Retorno OAuth incompleto.");
    const raw = await this.redis.get(`opspanel:gdrive:oauth:sess:${input.state}`);
    await this.redis.del(`opspanel:gdrive:oauth:sess:${input.state}`);
    if (!raw) return failUnknown("Sessão OAuth central expirada. Tente conectar de novo.");
    const session = JSON.parse(raw) as BrokerSession;
    const fail = (message: string) => ({
      redirectTo: appendQuery(session.returnUrl, { error: message, state: session.clientState }),
    });
    if (input.error) return fail(input.error_description || input.error);
    if (!input.code) return fail("Retorno OAuth incompleto.");
    try {
      const app = await this.hubApp();
      const token = await exchangeGoogleCode({
        clientId: app.clientId,
        clientSecret: app.clientSecret,
        redirectUri: app.redirectUri,
        code: input.code,
        codeVerifier: session.codeVerifier,
      });
      token.email = await fetchGoogleEmail(token.accessToken);
      const ticket = randomBytes(24).toString("hex");
      const payload: BrokerTicket = {
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        expiresAt: token.expiresAt,
        email: token.email,
        tokenType: token.tokenType,
      };
      await this.redis.set(`opspanel:gdrive:oauth:ticket:${ticket}`, JSON.stringify(payload), "EX", TICKET_TTL_SEC);
      return {
        redirectTo: appendQuery(session.returnUrl, { ticket, state: session.clientState }),
      };
    } catch (err) {
      return fail(err instanceof Error ? err.message : "Falha ao conectar Google Drive.");
    }
  }

  async redeem(input: { ticket?: string }) {
    this.assertHub();
    const ticket = input.ticket?.trim();
    if (!ticket) {
      throw new BadRequestException({ error: { code: "INVALID_TICKET", message: "Ticket OAuth ausente." } });
    }
    const key = `opspanel:gdrive:oauth:ticket:${ticket}`;
    const raw = await this.redis.get(key);
    await this.redis.del(key);
    if (!raw) {
      throw new BadRequestException({
        error: { code: "INVALID_TICKET", message: "Ticket OAuth inválido ou expirado." },
      });
    }
    const payload = JSON.parse(raw) as BrokerTicket;
    return {
      accessToken: payload.accessToken,
      refreshToken: payload.refreshToken,
      expiresAt: payload.expiresAt,
      email: payload.email,
      tokenType: payload.tokenType,
    };
  }

  async refresh(input: { refreshToken?: string }) {
    this.assertHub();
    const refreshToken = input.refreshToken?.trim();
    if (!refreshToken) {
      throw new BadRequestException({ error: { code: "INVALID_REFRESH", message: "Refresh token ausente." } });
    }
    const app = await this.hubApp();
    if (!app.configured) {
      throw new BadRequestException({
        error: { code: "GOOGLE_OAUTH_NOT_CONFIGURED", message: "O hub OAuth ainda não tem Client ID/Secret do Google." },
      });
    }
    const next = await refreshGoogleAccessToken({
      clientId: app.clientId,
      clientSecret: app.clientSecret,
      refreshToken,
    });
    return next;
  }
}
