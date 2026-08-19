import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { OrgRole } from "@opspanel/database";
import {
  googleOAuthBrokerBaseUrl,
  googleOAuthBrokerEndpoint,
  isGoogleOAuthBrokerHub,
  loadEnv,
} from "@opspanel/config";
import { encryptJson } from "@opspanel/security";
import { googleRedirectUri } from "../google-drive/google-oauth";
import { networkInterfaces } from "node:os";
import type { SessionUser } from "../auth/auth.service";
import { PrismaService } from "../prisma/prisma.service";
import { patchPanelUrls } from "../license/env-file";

const domainRegex = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

function canManage(user: SessionUser) {
  return user.role === OrgRole.owner || user.role === OrgRole.admin;
}

function guessServerIpv4(): string | null {
  const nets = networkInterfaces();
  for (const list of Object.values(nets)) {
    if (!list) continue;
    for (const net of list) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return null;
}

function normalizeDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
}

@Injectable()
export class InstanceSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(user: SessionUser) {
    const env = loadEnv();
    const [org, setup] = await Promise.all([
      this.prisma.client.organization.findUnique({ where: { id: user.organizationId } }),
      this.prisma.client.systemSetupState.upsert({
        where: { id: "default" },
        create: { id: "default" },
        update: {},
      }),
    ]);
    const serverIp = guessServerIpv4();
    const webUrl = (setup.panelUrl || env.WEB_URL).replace(/\/$/, "");
    const googleConfigured = Boolean(
      (env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET) ||
        (setup.googleDriveClientId && setup.googleDriveClientSecretCipher),
    );
    const brokerUrl = googleOAuthBrokerBaseUrl(env);
    const hub = isGoogleOAuthBrokerHub(env);
    const oauthMode = hub ? "hub" : brokerUrl ? "broker" : googleConfigured ? "local" : "none";
    const redirectUri = hub
      ? googleOAuthBrokerEndpoint((env.GOOGLE_OAUTH_BROKER_PUBLIC_URL || env.WEB_URL).replace(/\/$/, ""), "callback")
      : brokerUrl
        ? googleOAuthBrokerEndpoint(brokerUrl, "callback")
        : googleRedirectUri(webUrl);
    return {
      organization: org ? { id: org.id, name: org.name, slug: org.slug } : null,
      panelDomain: setup.panelDomain,
      panelUrl: setup.panelUrl ?? env.WEB_URL,
      webUrl: env.WEB_URL,
      apiUrl: env.API_URL,
      serverIp,
      canManage: canManage(user),
      googleDrive: {
        configured: googleConfigured || Boolean(brokerUrl),
        mode: oauthMode,
        brokerUrl,
        clientId: oauthMode === "broker" ? null : setup.googleDriveClientId || env.GOOGLE_OAUTH_CLIENT_ID || null,
        fromEnv: Boolean(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET),
        redirectUri,
      },
    };
  }

  async update(
    user: SessionUser,
    input: {
      organizationName?: string;
      panelDomain?: string | null;
      useHttps?: boolean;
      googleDriveClientId?: string | null;
      googleDriveClientSecret?: string | null;
    },
  ) {
    if (!canManage(user)) {
      throw new ForbiddenException({ error: { code: "FORBIDDEN", message: "Apenas owner/admin." } });
    }

    if (input.organizationName?.trim()) {
      await this.prisma.client.organization.update({
        where: { id: user.organizationId },
        data: { name: input.organizationName.trim() },
      });
    }

    if (input.panelDomain !== undefined) {
      await this.applyPanelDomain(user, input.panelDomain, input.useHttps !== false);
    }

    if (input.googleDriveClientId !== undefined || input.googleDriveClientSecret !== undefined) {
      await this.saveGoogleDriveApp(input.googleDriveClientId, input.googleDriveClientSecret);
    }

    return this.get(user);
  }

  private async saveGoogleDriveApp(clientId?: string | null, clientSecret?: string | null) {
    const env = loadEnv();
    const data: {
      googleDriveClientId?: string | null;
      googleDriveClientSecretCipher?: string | null;
      googleDriveClientSecretIv?: string | null;
      googleDriveClientSecretAuthTag?: string | null;
    } = {};
    if (clientId !== undefined) {
      data.googleDriveClientId = clientId?.trim() || null;
    }
    if (clientSecret !== undefined) {
      const secret = clientSecret?.trim();
      if (!secret) {
        data.googleDriveClientSecretCipher = null;
        data.googleDriveClientSecretIv = null;
        data.googleDriveClientSecretAuthTag = null;
      } else {
        const enc = encryptJson({ clientSecret: secret }, env.CREDENTIALS_ENCRYPTION_KEY);
        data.googleDriveClientSecretCipher = enc.ciphertext;
        data.googleDriveClientSecretIv = enc.iv;
        data.googleDriveClientSecretAuthTag = enc.authTag;
      }
    }
    await this.prisma.client.systemSetupState.upsert({
      where: { id: "default" },
      create: { id: "default", ...data },
      update: data,
    });
  }

  async applyPanelDomain(user: SessionUser, panelDomainRaw: string | null, useHttps = true) {
    if (!canManage(user)) {
      throw new ForbiddenException({ error: { code: "FORBIDDEN", message: "Apenas owner/admin." } });
    }

    if (!panelDomainRaw || !panelDomainRaw.trim()) {
      await this.prisma.client.systemSetupState.update({
        where: { id: "default" },
        data: { panelDomain: null, panelUrl: null },
      });
      return this.preview(null, useHttps);
    }

    const domain = normalizeDomain(panelDomainRaw);
    if (!domainRegex.test(domain)) {
      throw new BadRequestException({
        error: { code: "INVALID_DOMAIN", message: "Informe um domínio válido (ex: painel.suaempresa.com)." },
      });
    }

    const panelUrl = `${useHttps ? "https" : "http"}://${domain}`;
    // Mesma origem: Next faz rewrite de /api/v1 para a API local
    patchPanelUrls(panelUrl, panelUrl);

    await this.prisma.client.systemSetupState.upsert({
      where: { id: "default" },
      create: { id: "default", panelDomain: domain, panelUrl },
      update: { panelDomain: domain, panelUrl },
    });

    return this.preview(domain, useHttps);
  }

  preview(domain: string | null, useHttps = true) {
    const serverIp = guessServerIpv4() ?? "IP_DO_SERVIDOR";
    if (!domain) {
      return {
        ok: true,
        cleared: true,
        serverIp,
        message: "Domínio do painel removido. WEB_URL atual não foi alterado automaticamente.",
      };
    }
    const panelUrl = `${useHttps ? "https" : "http"}://${domain}`;
    return {
      ok: true,
      panelDomain: domain,
      panelUrl,
      serverIp,
      dns: {
        records: [
          { type: "A", name: domain, value: serverIp },
          { type: "A", name: `www.${domain}`, value: serverIp, optional: true },
        ],
        hint: `Crie um registro A apontando ${domain} para ${serverIp}. Depois aguarde a propagação DNS.`,
      },
      nginxSnippet: [
        `server {`,
        `  listen 80;`,
        `  server_name ${domain};`,
        `  location / {`,
        `    proxy_pass http://127.0.0.1:3000;`,
        `    proxy_http_version 1.1;`,
        `    proxy_set_header Host $host;`,
        `    proxy_set_header X-Real-IP $remote_addr;`,
        `    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`,
        `    proxy_set_header X-Forwarded-Proto $scheme;`,
        `    proxy_set_header Upgrade $http_upgrade;`,
        `    proxy_set_header Connection "upgrade";`,
        `  }`,
        `}`,
      ].join("\n"),
      nextSteps: [
        `1. DNS: registro A de ${domain} → ${serverIp}`,
        `2. No servidor: sudo bash scripts/configure-panel-domain.sh ${domain}`,
        `3. Reinicie o painel: pm2 restart opspanel-api opspanel-web`,
        `4. Acesse ${panelUrl}`,
      ],
      restartRequired: true,
    };
  }
}
