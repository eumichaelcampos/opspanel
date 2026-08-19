import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { OrgRole, UserSecretKind } from "@opspanel/database";
import { loadEnv } from "@opspanel/config";
import { decryptJson, encryptJson } from "@opspanel/security";
import { z } from "zod";
import type { SessionUser } from "../auth/auth.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  CloudflareApiError,
  type CloudflareAuth,
  WORDOPS_CF_OPTIMIZATIONS,
  createDnsRecord,
  createPageRule,
  deleteDnsRecord,
  deletePageRule,
  findZoneByDomain,
  listDnsRecords,
  listPageRules,
  patchZoneSetting,
  updateDnsRecord,
  updatePageRule,
  verifyCloudflareAuth,
} from "./cloudflare-api";
import {
  buildCloudflareAuthorizeUrl,
  exchangeCloudflareAuthCode,
  generatePkce,
  parseOauthScopes,
  refreshCloudflareAccessToken,
  signOAuthState,
  verifyOAuthState,
} from "./cloudflare-oauth";

const tokenSchema = z.object({
  mode: z.literal("token"),
  apiToken: z.string().min(20).max(512),
  label: z.string().max(80).optional(),
});

const globalSchema = z.object({
  mode: z.literal("global"),
  apiKey: z.string().min(20).max(128),
  email: z.string().email().max(200),
  label: z.string().max(80).optional(),
});

const connectSchema = z.discriminatedUnion("mode", [tokenSchema, globalSchema]);

const dnsCreateSchema = z.object({
  type: z.enum(["A", "AAAA", "CNAME", "TXT", "MX", "NS", "SRV", "CAA"]),
  name: z.string().min(1).max(255),
  content: z.string().min(1).max(2048),
  proxied: z.boolean().optional(),
  ttl: z.number().int().min(1).max(86400).optional(),
  priority: z.number().int().min(0).max(65535).optional(),
});

const pageRuleActionSchema = z.object({
  id: z.string().min(1).max(80),
  value: z.unknown().optional(),
});

const pageRuleSchema = z.object({
  url: z.string().min(3).max(500),
  status: z.enum(["active", "disabled"]).optional(),
  priority: z.number().int().min(1).max(100).optional(),
  actions: z.array(pageRuleActionSchema).min(1).max(20),
});

function pageRuleTargets(url: string): { target: string; constraint: { operator: string; value: string } }[] {
  return [{ target: "url", constraint: { operator: "matches", value: url.trim() } }];
}

function maskToken(token: string): string {
  const t = token.trim();
  if (t.length < 12) return "****";
  return `${t.slice(0, 6)}…${t.slice(-4)}`;
}

function canReadSites(user: SessionUser) {
  return Boolean(user.organizationId);
}

function canWriteSites(user: SessionUser) {
  const roles: OrgRole[] = [OrgRole.owner, OrgRole.admin, OrgRole.operator, OrgRole.developer];
  return roles.includes(user.role);
}

function mapCfError(err: unknown): never {
  if (err instanceof CloudflareApiError) {
    throw new BadRequestException({
      error: { code: "CLOUDFLARE_API_ERROR", message: err.message },
    });
  }
  throw err;
}

@Injectable()
export class CloudflareService {
  constructor(private readonly prisma: PrismaService) {}

  private encryptionKey() {
    return loadEnv().CREDENTIALS_ENCRYPTION_KEY;
  }

  async getCredentialsStatus(userId: string) {
    const env = loadEnv();
    const oauthConfigured = Boolean(env.CLOUDFLARE_OAUTH_CLIENT_ID && env.CLOUDFLARE_OAUTH_CLIENT_SECRET);
    const row = await this.prisma.client.userSecret.findUnique({
      where: { userId_kind: { userId, kind: UserSecretKind.cloudflare_credentials } },
    });
    if (!row) {
      return {
        connected: false as const,
        hint: null,
        mode: null,
        updatedAt: null,
        oauthConfigured,
        oauthScopes: parseOauthScopes(env.CLOUDFLARE_OAUTH_SCOPES),
      };
    }
    let mode: "token" | "global" | "oauth" | null = null;
    try {
      const payload = decryptJson<{ mode?: string }>(
        { ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag, keyVersion: row.keyVersion },
        this.encryptionKey(),
      );
      if (payload.mode === "global") mode = "global";
      else if (payload.mode === "oauth") mode = "oauth";
      else mode = "token";
    } catch {
      mode = null;
    }
    return {
      connected: true as const,
      hint: row.hint,
      mode,
      label: row.label,
      updatedAt: row.updatedAt,
      oauthConfigured,
      oauthScopes: parseOauthScopes(env.CLOUDFLARE_OAUTH_SCOPES),
    };
  }

  private oauthConfig() {
    const env = loadEnv();
    const clientId = env.CLOUDFLARE_OAUTH_CLIENT_ID?.trim();
    const clientSecret = env.CLOUDFLARE_OAUTH_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) {
      throw new BadRequestException({
        error: {
          code: "CF_OAUTH_NOT_CONFIGURED",
          message:
            "OAuth Cloudflare ainda não está configurado no servidor. Use API Token manual ou peça ao admin para definir CLOUDFLARE_OAUTH_CLIENT_ID/SECRET.",
        },
      });
    }
    const redirectUri = `${env.WEB_URL.replace(/\/$/, "")}/api/v1/me/cloudflare/oauth/callback`;
    return {
      clientId,
      clientSecret,
      redirectUri,
      scopes: parseOauthScopes(env.CLOUDFLARE_OAUTH_SCOPES),
      webUrl: env.WEB_URL.replace(/\/$/, ""),
      sessionSecret: env.SESSION_SECRET,
    };
  }

  beginOAuth(userId: string): string {
    const cfg = this.oauthConfig();
    const { codeVerifier, codeChallenge } = generatePkce();
    const state = signOAuthState(
      {
        userId,
        codeVerifier,
        exp: Date.now() + 15 * 60 * 1000,
      },
      cfg.sessionSecret,
    );
    return buildCloudflareAuthorizeUrl({
      clientId: cfg.clientId,
      redirectUri: cfg.redirectUri,
      state,
      codeChallenge,
      scopes: cfg.scopes,
    });
  }

  async completeOAuth(query: { code?: string; state?: string; error?: string; error_description?: string }) {
    const cfg = this.oauthConfig();
    if (query.error) {
      const msg = query.error_description || query.error;
      return {
        ok: false as const,
        redirectTo: `${cfg.webUrl}/settings/account?cloudflare=error&message=${encodeURIComponent(msg)}`,
      };
    }
    if (!query.code || !query.state) {
      return {
        ok: false as const,
        redirectTo: `${cfg.webUrl}/settings/account?cloudflare=error&message=${encodeURIComponent("Callback OAuth incompleto.")}`,
      };
    }
    const parsed = verifyOAuthState(query.state, cfg.sessionSecret);
    if (!parsed) {
      return {
        ok: false as const,
        redirectTo: `${cfg.webUrl}/settings/account?cloudflare=error&message=${encodeURIComponent("State OAuth inválido ou expirado.")}`,
      };
    }

    let token;
    try {
      token = await exchangeCloudflareAuthCode({
        clientId: cfg.clientId,
        clientSecret: cfg.clientSecret,
        redirectUri: cfg.redirectUri,
        code: query.code,
        codeVerifier: parsed.codeVerifier,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Falha ao obter token OAuth.";
      return {
        ok: false as const,
        redirectTo: `${cfg.webUrl}/settings/account?cloudflare=error&message=${encodeURIComponent(msg)}`,
      };
    }

    if (!token.access_token || !token.refresh_token) {
      return {
        ok: false as const,
        redirectTo: `${cfg.webUrl}/settings/account?cloudflare=error&message=${encodeURIComponent("Cloudflare não retornou refresh_token. Inclua o scope offline_access no OAuth client.")}`,
      };
    }

    const auth: CloudflareAuth = {
      mode: "oauth",
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + Math.max(60, token.expires_in || 3600) * 1000,
      scope: token.scope,
    };

    let hint = "OAuth Cloudflare";
    try {
      const verified = await verifyCloudflareAuth(auth);
      hint = verified.accountHint;
    } catch {
      /* ainda salva; permissões podem ser suficientes para zones específicas */
    }

    const enc = encryptJson(auth, this.encryptionKey());
    await this.prisma.client.userSecret.upsert({
      where: { userId_kind: { userId: parsed.userId, kind: UserSecretKind.cloudflare_credentials } },
      create: {
        userId: parsed.userId,
        kind: UserSecretKind.cloudflare_credentials,
        label: "Cloudflare OAuth",
        hint,
        ciphertext: enc.ciphertext,
        iv: enc.iv,
        authTag: enc.authTag,
        keyVersion: enc.keyVersion,
      },
      update: {
        label: "Cloudflare OAuth",
        hint,
        ciphertext: enc.ciphertext,
        iv: enc.iv,
        authTag: enc.authTag,
        keyVersion: enc.keyVersion,
      },
    });

    return {
      ok: true as const,
      redirectTo: `${cfg.webUrl}/settings/account?cloudflare=connected`,
    };
  }

  private async persistAuth(userId: string, auth: CloudflareAuth, label: string, hint: string) {
    const enc = encryptJson(auth, this.encryptionKey());
    await this.prisma.client.userSecret.upsert({
      where: { userId_kind: { userId, kind: UserSecretKind.cloudflare_credentials } },
      create: {
        userId,
        kind: UserSecretKind.cloudflare_credentials,
        label,
        hint,
        ciphertext: enc.ciphertext,
        iv: enc.iv,
        authTag: enc.authTag,
        keyVersion: enc.keyVersion,
      },
      update: {
        label,
        hint,
        ciphertext: enc.ciphertext,
        iv: enc.iv,
        authTag: enc.authTag,
        keyVersion: enc.keyVersion,
      },
    });
  }

  async getAuth(userId: string): Promise<CloudflareAuth | null> {
    const row = await this.prisma.client.userSecret.findUnique({
      where: { userId_kind: { userId, kind: UserSecretKind.cloudflare_credentials } },
    });
    if (!row) return null;
    try {
      const payload = decryptJson<CloudflareAuth & { mode: string }>(
        { ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag, keyVersion: row.keyVersion },
        this.encryptionKey(),
      );
      if (payload.mode === "global") {
        return {
          mode: "global",
          apiKey: String((payload as { apiKey: string }).apiKey || "").trim(),
          email: String((payload as { email: string }).email || "").trim(),
        };
      }
      if (payload.mode === "oauth") {
        const oauth = payload as Extract<CloudflareAuth, { mode: "oauth" }>;
        if (!oauth.accessToken || !oauth.refreshToken) return null;
        // renova ~2 min antes de expirar
        if (oauth.expiresAt && oauth.expiresAt > Date.now() + 120_000) {
          return oauth;
        }
        const env = loadEnv();
        const clientId = env.CLOUDFLARE_OAUTH_CLIENT_ID?.trim();
        const clientSecret = env.CLOUDFLARE_OAUTH_CLIENT_SECRET?.trim();
        if (!clientId || !clientSecret) return oauth;
        try {
          const refreshed = await refreshCloudflareAccessToken({
            clientId,
            clientSecret,
            refreshToken: oauth.refreshToken,
          });
          const next: CloudflareAuth = {
            mode: "oauth",
            accessToken: refreshed.access_token,
            refreshToken: refreshed.refresh_token || oauth.refreshToken,
            expiresAt: Date.now() + Math.max(60, refreshed.expires_in || 3600) * 1000,
            scope: refreshed.scope || oauth.scope,
          };
          await this.persistAuth(userId, next, row.label || "Cloudflare OAuth", row.hint || "OAuth Cloudflare");
          return next;
        } catch {
          return oauth;
        }
      }
      return {
        mode: "token",
        apiToken: String((payload as { apiToken: string }).apiToken || "").trim(),
      };
    } catch {
      return null;
    }
  }

  async connect(userId: string, body: unknown) {
    const parsed = connectSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: "VALIDATION_ERROR",
          message: "Informe um API Token Cloudflare ou e-mail + Global API Key.",
        },
      });
    }

    const auth: CloudflareAuth =
      parsed.data.mode === "token"
        ? { mode: "token", apiToken: parsed.data.apiToken.trim() }
        : {
            mode: "global",
            apiKey: parsed.data.apiKey.trim(),
            email: parsed.data.email.trim().toLowerCase(),
          };

    let verified: { ok: true; accountHint: string };
    try {
      verified = await verifyCloudflareAuth(auth);
    } catch (err) {
      mapCfError(err);
    }

    const hint =
      auth.mode === "token"
        ? maskToken(auth.apiToken)
        : `${auth.email} · ${maskToken(auth.apiKey)}`;
    const label = parsed.data.label?.trim() || verified.accountHint || "Cloudflare";
    const enc = encryptJson(auth, this.encryptionKey());

    await this.prisma.client.userSecret.upsert({
      where: { userId_kind: { userId, kind: UserSecretKind.cloudflare_credentials } },
      create: {
        userId,
        kind: UserSecretKind.cloudflare_credentials,
        label,
        hint,
        ciphertext: enc.ciphertext,
        iv: enc.iv,
        authTag: enc.authTag,
        keyVersion: enc.keyVersion,
      },
      update: {
        label,
        hint,
        ciphertext: enc.ciphertext,
        iv: enc.iv,
        authTag: enc.authTag,
        keyVersion: enc.keyVersion,
      },
    });

    return { connected: true, hint, mode: auth.mode, accountHint: verified.accountHint };
  }

  async disconnect(userId: string) {
    const existing = await this.prisma.client.userSecret.findUnique({
      where: { userId_kind: { userId, kind: UserSecretKind.cloudflare_credentials } },
    });
    if (!existing) {
      throw new NotFoundException({
        error: { code: "NOT_FOUND", message: "Nenhuma conta Cloudflare conectada." },
      });
    }
    await this.prisma.client.userSecret.delete({ where: { id: existing.id } });
    return { connected: false };
  }

  private async requireAuth(userId: string): Promise<CloudflareAuth> {
    const auth = await this.getAuth(userId);
    if (!auth) {
      throw new BadRequestException({
        error: {
          code: "CLOUDFLARE_NOT_CONNECTED",
          message: "Conecte sua conta Cloudflare em Conta & API antes de continuar.",
        },
      });
    }
    return auth;
  }

  private async requireSite(user: SessionUser, siteId: string) {
    if (!canReadSites(user)) {
      throw new ForbiddenException({ error: { code: "FORBIDDEN", message: "Permissão insuficiente." } });
    }
    const site = await this.prisma.client.site.findFirst({
      where: { id: siteId, organizationId: user.organizationId, deletedAt: null },
      include: { server: { select: { id: true, name: true, host: true } } },
    });
    if (!site) {
      throw new NotFoundException({ error: { code: "SITE_NOT_FOUND", message: "Site não encontrado." } });
    }
    return site;
  }

  private assertWrite(user: SessionUser) {
    if (!canWriteSites(user)) {
      throw new ForbiddenException({ error: { code: "FORBIDDEN", message: "Permissão insuficiente." } });
    }
  }

  private async resolveZone(user: SessionUser, siteId: string) {
    const site = await this.requireSite(user, siteId);
    const auth = await this.requireAuth(user.id);
    let zone;
    try {
      zone = await findZoneByDomain(auth, site.domain);
    } catch (err) {
      mapCfError(err);
    }
    if (!zone) {
      throw new NotFoundException({
        error: {
          code: "CF_ZONE_NOT_FOUND",
          message: `Nenhuma zona Cloudflare encontrada para ${site.domain}. Confirme se o domínio está na conta conectada.`,
        },
      });
    }
    return { site, auth, zone };
  }

  async getOverview(user: SessionUser, siteId: string) {
    const site = await this.requireSite(user, siteId);
    const creds = await this.getCredentialsStatus(user.id);
    if (!creds.connected) {
      return {
        connected: false,
        site: { id: site.id, domain: site.domain, serverHost: site.server.host },
        zone: null,
        credentials: creds,
      };
    }
    const auth = await this.requireAuth(user.id);
    let zone = null;
    let zoneError: string | null = null;
    try {
      zone = await findZoneByDomain(auth, site.domain);
      if (!zone) {
        zoneError = `Zona não encontrada para ${site.domain}.`;
      }
    } catch (err) {
      zoneError = err instanceof Error ? err.message : "Falha ao consultar Cloudflare.";
    }
    return {
      connected: true,
      site: { id: site.id, domain: site.domain, serverHost: site.server.host },
      zone: zone
        ? {
            id: zone.id,
            name: zone.name,
            status: zone.status,
            paused: zone.paused,
            plan: zone.plan?.name ?? null,
            nameServers: zone.name_servers ?? [],
          }
        : null,
      zoneError,
      credentials: creds,
      optimizations: WORDOPS_CF_OPTIMIZATIONS.map((o) => ({ id: o.id, label: o.label })),
    };
  }

  async listDns(user: SessionUser, siteId: string) {
    const { auth, zone } = await this.resolveZone(user, siteId);
    try {
      const records = await listDnsRecords(auth, zone.id);
      return {
        zoneId: zone.id,
        zoneName: zone.name,
        records: records
          .map((r) => ({
            id: r.id,
            type: r.type,
            name: r.name,
            content: r.content,
            proxied: Boolean(r.proxied),
            proxiable: Boolean(r.proxiable),
            ttl: r.ttl,
            priority: r.priority ?? null,
            locked: Boolean(r.locked),
          }))
          .sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type)),
      };
    } catch (err) {
      mapCfError(err);
    }
  }

  async createDns(user: SessionUser, siteId: string, body: unknown) {
    this.assertWrite(user);
    const parsed = dnsCreateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: { code: "VALIDATION_ERROR", message: "Dados do registro DNS inválidos." },
      });
    }
    const { auth, zone } = await this.resolveZone(user, siteId);
    try {
      const record = await createDnsRecord(auth, zone.id, parsed.data);
      return { record };
    } catch (err) {
      mapCfError(err);
    }
  }

  async updateDns(user: SessionUser, siteId: string, recordId: string, body: unknown) {
    this.assertWrite(user);
    const parsed = dnsCreateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: { code: "VALIDATION_ERROR", message: "Dados do registro DNS inválidos." },
      });
    }
    const { auth, zone } = await this.resolveZone(user, siteId);
    try {
      const record = await updateDnsRecord(auth, zone.id, recordId, parsed.data);
      return { record };
    } catch (err) {
      mapCfError(err);
    }
  }

  async deleteDns(user: SessionUser, siteId: string, recordId: string) {
    this.assertWrite(user);
    const { auth, zone } = await this.resolveZone(user, siteId);
    try {
      await deleteDnsRecord(auth, zone.id, recordId);
      return { ok: true };
    } catch (err) {
      mapCfError(err);
    }
  }

  /** Cria/atualiza A @ e www apontando para o IP do servidor, com proxy CF. */
  async pointToServer(user: SessionUser, siteId: string, body?: unknown) {
    this.assertWrite(user);
    const opts = z
      .object({
        proxied: z.boolean().optional(),
        includeWww: z.boolean().optional(),
      })
      .safeParse(body ?? {});
    const proxied = opts.success ? (opts.data.proxied ?? true) : true;
    const includeWww = opts.success ? (opts.data.includeWww ?? true) : true;

    const { site, auth, zone } = await this.resolveZone(user, siteId);
    const serverIp = site.server.host.trim();
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(serverIp)) {
      throw new BadRequestException({
        error: {
          code: "SERVER_HOST_NOT_IP",
          message: `O host do servidor (${serverIp}) não é um IPv4. Informe um IP no servidor para apontar o DNS automaticamente.`,
        },
      });
    }

    try {
      const existing = await listDnsRecords(auth, zone.id);
      const names = [site.domain];
      if (includeWww) names.push(`www.${site.domain}`);

      const results: { name: string; action: string; id: string }[] = [];
      for (const name of names) {
        const current = existing.find(
          (r) => r.type === "A" && (r.name === name || r.name === `${name}.`),
        );
        if (current) {
          const updated = await updateDnsRecord(auth, zone.id, current.id, {
            type: "A",
            name,
            content: serverIp,
            proxied,
            ttl: 1,
          });
          results.push({ name, action: "updated", id: updated.id });
        } else {
          const created = await createDnsRecord(auth, zone.id, {
            type: "A",
            name,
            content: serverIp,
            proxied,
            ttl: 1,
          });
          results.push({ name, action: "created", id: created.id });
        }
      }
      return { serverIp, proxied, results };
    } catch (err) {
      mapCfError(err);
    }
  }

  async applyOptimizations(user: SessionUser, siteId: string) {
    this.assertWrite(user);
    const { auth, zone } = await this.resolveZone(user, siteId);
    const applied: { id: string; label: string; ok: boolean; error?: string }[] = [];
    for (const opt of WORDOPS_CF_OPTIMIZATIONS) {
      try {
        await patchZoneSetting(auth, zone.id, opt.id, opt.value);
        applied.push({ id: opt.id, label: opt.label, ok: true });
      } catch (err) {
        applied.push({
          id: opt.id,
          label: opt.label,
          ok: false,
          error: err instanceof Error ? err.message : "falhou",
        });
      }
    }
    const okCount = applied.filter((a) => a.ok).length;
    return {
      zoneId: zone.id,
      applied,
      summary: `${okCount}/${applied.length} otimizações aplicadas`,
    };
  }

  async listRules(user: SessionUser, siteId: string) {
    const { auth, zone } = await this.resolveZone(user, siteId);
    try {
      const rules = await listPageRules(auth, zone.id);
      return {
        zoneId: zone.id,
        rules: [...rules]
          .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
          .map((r) => ({
            id: r.id,
            priority: r.priority,
            status: r.status,
            url: r.targets.find((t) => t.constraint?.value)?.constraint?.value ?? "",
            targets: r.targets,
            actions: r.actions,
          })),
      };
    } catch (err) {
      mapCfError(err);
    }
  }

  async applyWordpressPageRules(user: SessionUser, siteId: string) {
    this.assertWrite(user);
    const { site, auth, zone } = await this.resolveZone(user, siteId);
    const domain = site.domain;

    const desired = [
      {
        key: "wp-admin",
        url: `*${domain}/wp-admin*`,
        actions: [
          { id: "cache_level", value: "bypass" },
          { id: "security_level", value: "high" },
        ],
      },
      {
        key: "wp-login",
        url: `*${domain}/wp-login.php*`,
        actions: [
          { id: "cache_level", value: "bypass" },
          { id: "security_level", value: "high" },
        ],
      },
    ];

    try {
      const existing = await listPageRules(auth, zone.id);
      const created: { key: string; id: string; skipped?: boolean; reason?: string }[] = [];

      for (const rule of desired) {
        const already = existing.find((r) =>
          r.targets.some((t) => String(t.constraint?.value || "").includes(rule.key === "wp-admin" ? "/wp-admin" : "wp-login")),
        );
        if (already) {
          created.push({ key: rule.key, id: already.id, skipped: true, reason: "já existe" });
          continue;
        }
        const made = await createPageRule(auth, zone.id, {
          targets: [
            {
              target: "url",
              constraint: { operator: "matches", value: rule.url },
            },
          ],
          actions: rule.actions,
          priority: rule.key === "wp-admin" ? 2 : 1,
          status: "active",
        });
        created.push({ key: rule.key, id: made.id });
      }

      return { zoneId: zone.id, rules: created };
    } catch (err) {
      mapCfError(err);
    }
  }

  async createRule(user: SessionUser, siteId: string, body: unknown) {
    this.assertWrite(user);
    const parsed = pageRuleSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: { code: "VALIDATION_ERROR", message: "Dados da page rule inválidos." },
      });
    }
    const { auth, zone } = await this.resolveZone(user, siteId);
    try {
      const rule = await createPageRule(auth, zone.id, {
        targets: pageRuleTargets(parsed.data.url),
        actions: parsed.data.actions,
        priority: parsed.data.priority ?? 1,
        status: parsed.data.status ?? "active",
      });
      return { rule };
    } catch (err) {
      mapCfError(err);
    }
  }

  async updateRule(user: SessionUser, siteId: string, ruleId: string, body: unknown) {
    this.assertWrite(user);
    const parsed = pageRuleSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: { code: "VALIDATION_ERROR", message: "Dados da page rule inválidos." },
      });
    }
    const { auth, zone } = await this.resolveZone(user, siteId);
    try {
      const rule = await updatePageRule(auth, zone.id, ruleId, {
        targets: pageRuleTargets(parsed.data.url),
        actions: parsed.data.actions,
        priority: parsed.data.priority ?? 1,
        status: parsed.data.status ?? "active",
      });
      return { rule };
    } catch (err) {
      mapCfError(err);
    }
  }

  async deleteRule(user: SessionUser, siteId: string, ruleId: string) {
    this.assertWrite(user);
    const { auth, zone } = await this.resolveZone(user, siteId);
    try {
      await deletePageRule(auth, zone.id, ruleId);
      return { ok: true };
    } catch (err) {
      mapCfError(err);
    }
  }
}
