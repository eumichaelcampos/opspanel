import {
  BadRequestException,
  Injectable,
} from "@nestjs/common";
import { UserSecretKind } from "@opspanel/database";
import {
  googleOAuthBrokerBaseUrl,
  googleOAuthBrokerEndpoint,
  loadEnv,
} from "@opspanel/config";
import { decryptJson, encryptJson } from "@opspanel/security";
import { PrismaService } from "../prisma/prisma.service";
import {
  buildGoogleAuthorizeUrl,
  exchangeGoogleCode,
  fetchGoogleEmail,
  generatePkce,
  googleRedirectUri,
  refreshGoogleAccessToken,
  signOAuthState,
  verifyOAuthState,
  type GoogleDriveToken,
} from "./google-oauth";
import { redeemGoogleOAuthTicket, refreshGoogleTokenViaBroker } from "./google-oauth-broker.client";
import { googleBrokerCompleteUrl } from "./google-oauth-broker.util";
import { driveListSiteBackups, type DriveBackupFile } from "./drive-rest";

@Injectable()
export class GoogleDriveService {
  constructor(private readonly prisma: PrismaService) {}

  private encryptionKey() {
    return loadEnv().CREDENTIALS_ENCRYPTION_KEY;
  }

  async oauthApp() {
    const env = loadEnv();
    const setup = await this.prisma.client.systemSetupState.upsert({
      where: { id: "default" },
      create: { id: "default" },
      update: {},
    });
    let clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim() || setup.googleDriveClientId?.trim() || "";
    let clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() || "";
    if (!clientSecret && setup.googleDriveClientSecretCipher && setup.googleDriveClientSecretIv && setup.googleDriveClientSecretAuthTag) {
      try {
        const payload = decryptJson<{ clientSecret?: string }>(
          {
            ciphertext: setup.googleDriveClientSecretCipher,
            iv: setup.googleDriveClientSecretIv,
            authTag: setup.googleDriveClientSecretAuthTag,
            keyVersion: 1,
          },
          this.encryptionKey(),
        );
        clientSecret = payload.clientSecret?.trim() || "";
      } catch {
        clientSecret = "";
      }
    }
    const webUrl = (setup.panelUrl || env.WEB_URL).replace(/\/$/, "");
    const brokerUrl = googleOAuthBrokerBaseUrl(env);
    const localConfigured = Boolean(clientId && clientSecret);
    return {
      clientId,
      clientSecret,
      configured: localConfigured,
      brokerUrl,
      oauthConfigured: Boolean(brokerUrl) || localConfigured,
      oauthMode: (brokerUrl ? "broker" : localConfigured ? "local" : "none") as "broker" | "local" | "none",
      redirectUri: brokerUrl ? googleOAuthBrokerEndpoint(brokerUrl, "callback") : googleRedirectUri(webUrl),
      webUrl,
    };
  }

  async getStatus(userId: string) {
    const app = await this.oauthApp();
    const status = {
      oauthConfigured: app.oauthConfigured,
      oauthMode: app.oauthMode,
      redirectUri: app.oauthMode === "local" ? app.redirectUri : undefined,
    };
    const row = await this.prisma.client.userSecret.findUnique({
      where: { userId_kind: { userId, kind: UserSecretKind.google_drive } },
    });
    if (!row) {
      return { connected: false as const, hint: null, ...status };
    }
    return {
      connected: true as const,
      hint: row.hint,
      label: row.label,
      updatedAt: row.updatedAt,
      ...status,
    };
  }

  async beginOAuth(userId: string): Promise<string> {
    const app = await this.oauthApp();
    const env = loadEnv();
    if (app.brokerUrl) {
      const clientState = signOAuthState(
        { userId, codeVerifier: "broker", exp: Date.now() + 15 * 60 * 1000 },
        env.SESSION_SECRET,
      );
      const params = new URLSearchParams({
        returnUrl: googleBrokerCompleteUrl(app.webUrl),
        clientState,
      });
      return `${googleOAuthBrokerEndpoint(app.brokerUrl, "start")}?${params.toString()}`;
    }
    if (!app.configured) {
      throw new BadRequestException({
        error: {
          code: "GOOGLE_OAUTH_NOT_CONFIGURED",
          message:
            "OAuth do Google Drive ainda não está configurado. Use o OAuth central da OpsPanel ou informe Client ID/Secret em Configurações → Empresa.",
        },
      });
    }
    const { codeVerifier, codeChallenge } = generatePkce();
    const state = signOAuthState(
      { userId, codeVerifier, exp: Date.now() + 15 * 60 * 1000 },
      env.SESSION_SECRET,
    );
    return buildGoogleAuthorizeUrl({
      clientId: app.clientId,
      redirectUri: app.redirectUri,
      state,
      codeChallenge,
    });
  }

  async completeOAuthBroker(input: { ticket?: string; state?: string; error?: string }) {
    const app = await this.oauthApp();
    const web = app.webUrl;
    const fail = (message: string) => ({
      redirectTo: `${web}/settings/account?google=error&message=${encodeURIComponent(message)}`,
    });
    if (input.error) return fail(input.error);
    if (!input.ticket || !input.state) return fail("Retorno OAuth incompleto.");
    const parsed = verifyOAuthState(input.state, loadEnv().SESSION_SECRET);
    if (!parsed) return fail("Sessão OAuth inválida ou expirada.");
    if (!app.brokerUrl) return fail("OAuth central não está configurado nesta instalação.");
    try {
      const token = await redeemGoogleOAuthTicket({
        brokerUrl: app.brokerUrl,
        ticket: input.ticket,
      });
      await this.saveUserToken(parsed.userId, {
        ...token,
        viaBroker: true,
        brokerUrl: app.brokerUrl,
      });
      return { redirectTo: `${web}/settings/account?google=connected` };
    } catch (err) {
      return fail(err instanceof Error ? err.message : "Falha ao conectar Google Drive.");
    }
  }

  async completeOAuth(input: { code?: string; state?: string; error?: string; error_description?: string }) {
    const app = await this.oauthApp();
    const web = app.webUrl;
    const fail = (message: string) => ({
      redirectTo: `${web}/settings/account?google=error&message=${encodeURIComponent(message)}`,
    });
    if (input.error) return fail(input.error_description || input.error);
    if (!input.code || !input.state) return fail("Retorno OAuth incompleto.");
    const parsed = verifyOAuthState(input.state, loadEnv().SESSION_SECRET);
    if (!parsed) return fail("Sessão OAuth inválida ou expirada.");
    try {
      const token = await exchangeGoogleCode({
        clientId: app.clientId,
        clientSecret: app.clientSecret,
        redirectUri: app.redirectUri,
        code: input.code,
        codeVerifier: parsed.codeVerifier,
      });
      const email = await fetchGoogleEmail(token.accessToken);
      token.email = email;
      await this.saveUserToken(parsed.userId, token);
      return { redirectTo: `${web}/settings/account?google=connected` };
    } catch (err) {
      return fail(err instanceof Error ? err.message : "Falha ao conectar Google Drive.");
    }
  }

  async disconnect(userId: string) {
    await this.prisma.client.userSecret.deleteMany({
      where: { userId, kind: UserSecretKind.google_drive },
    });
    return { connected: false as const };
  }

  async getValidAccessToken(userId: string): Promise<string | null> {
    const app = await this.oauthApp();
    const row = await this.prisma.client.userSecret.findUnique({
      where: { userId_kind: { userId, kind: UserSecretKind.google_drive } },
    });
    if (!row) return null;
    let token: GoogleDriveToken;
    try {
      token = decryptJson<GoogleDriveToken>(
        { ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag, keyVersion: row.keyVersion },
        this.encryptionKey(),
      );
    } catch {
      return null;
    }
    if (!token.refreshToken) return null;
    if (token.expiresAt > Date.now() + 60_000 && token.accessToken) return token.accessToken;
    try {
      const refreshed = await this.refreshStoredToken(token, app);
      const next: GoogleDriveToken = { ...token, ...refreshed };
      const enc = encryptJson(next, this.encryptionKey());
      await this.prisma.client.userSecret.update({
        where: { id: row.id },
        data: { ciphertext: enc.ciphertext, iv: enc.iv, authTag: enc.authTag, keyVersion: enc.keyVersion },
      });
      return next.accessToken;
    } catch {
      return null;
    }
  }

  async listSiteBackups(userId: string, domain: string): Promise<DriveBackupFile[]> {
    const access = await this.getValidAccessToken(userId);
    if (!access) return [];
    try {
      return await driveListSiteBackups(access, domain.toLowerCase());
    } catch {
      return [];
    }
  }

  private async refreshStoredToken(
    token: GoogleDriveToken,
    app: Awaited<ReturnType<GoogleDriveService["oauthApp"]>>,
  ) {
    const brokerUrl = token.viaBroker ? token.brokerUrl || app.brokerUrl : null;
    if (brokerUrl) {
      return refreshGoogleTokenViaBroker({
        brokerUrl,
        refreshToken: token.refreshToken,
        licenseKey: loadEnv().LICENSE_KEY,
      });
    }
    if (!app.configured) throw new Error("OAuth local não configurado.");
    return refreshGoogleAccessToken({
      clientId: app.clientId,
      clientSecret: app.clientSecret,
      refreshToken: token.refreshToken,
    });
  }

  private async saveUserToken(userId: string, token: GoogleDriveToken) {
    const enc = encryptJson(token, this.encryptionKey());
    await this.prisma.client.userSecret.upsert({
      where: { userId_kind: { userId, kind: UserSecretKind.google_drive } },
      create: {
        userId,
        kind: UserSecretKind.google_drive,
        label: "Google Drive",
        hint: token.email ?? "Google Drive",
        ciphertext: enc.ciphertext,
        iv: enc.iv,
        authTag: enc.authTag,
        keyVersion: enc.keyVersion,
      },
      update: {
        label: "Google Drive",
        hint: token.email ?? "Google Drive",
        ciphertext: enc.ciphertext,
        iv: enc.iv,
        authTag: enc.authTag,
        keyVersion: enc.keyVersion,
      },
    });
  }
}
