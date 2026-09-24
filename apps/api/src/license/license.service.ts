import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { LicenseStatus } from "@opspanel/database";
import { loadEnv } from "@opspanel/config";
import {
  type Entitlements,
  isLicenseKeyFormat,
  resolveEntitlementsFromEnv,
  verifyEntitlementsJwt,
} from "@opspanel/licensing";
import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { PrismaService } from "../prisma/prisma.service";
import { LicenseCloudClient, type HeartbeatMetrics } from "./license-cloud.client";
import { patchEnvFile } from "./env-file";

export type LicenseSummary = {
  instanceId: string;
  plan: string;
  status: LicenseStatus;
  entitlements: Entitlements;
  validUntil: string | null;
  lastSyncAt: string | null;
  licenseKeyConfigured: boolean;
  cloudConnected: boolean;
  lastSyncError: string | null;
  billing?: {
    enabled: boolean;
    subscriptionStatus: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    managedByStripe: boolean;
  };
};

const GRACE_MS = 7 * 86400 * 1000;
const HEARTBEAT_MS = 6 * 60 * 60 * 1000;

@Injectable()
export class LicenseService implements OnModuleInit, OnModuleDestroy {
  private cached: LicenseSummary | null = null;
  private cachedBilling: LicenseSummary["billing"] | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastSyncError: string | null = null;
  private readonly logger = new Logger(LicenseService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.bootstrapFromEnv();
    await this.syncWithCloud("activate").catch((err) => {
      this.lastSyncError = err instanceof Error ? err.message : String(err);
      this.logger.warn(`License cloud sync skipped: ${this.lastSyncError}`);
    });
    this.heartbeatTimer = setInterval(() => {
      void this.syncWithCloud("heartbeat").catch((err) => {
        this.lastSyncError = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Heartbeat failed: ${this.lastSyncError}`);
      });
    }, HEARTBEAT_MS);
  }

  onModuleDestroy() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
  }

  private hashKey(key: string): string {
    return createHash("sha256").update(key).digest("hex");
  }

  async bootstrapFromEnv() {
    const env = loadEnv();
    let entitlements: Entitlements;
    try {
      entitlements = resolveEntitlementsFromEnv({
        licensePlan: env.LICENSE_PLAN,
        entitlementsJwt: env.LICENSE_ENTITLEMENTS_JWT,
        signingSecret: env.LICENSE_SIGNING_SECRET,
      });
    } catch (err) {
      throw new Error(`License bootstrap failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const licenseKeyHash =
      env.LICENSE_KEY && isLicenseKeyFormat(env.LICENSE_KEY) ? this.hashKey(env.LICENSE_KEY) : null;

    const existing = await this.prisma.client.licenseState.findUnique({ where: { id: "default" } });
    const instanceId = existing?.instanceId ?? randomUUID();

    const validUntil = env.LICENSE_ENTITLEMENTS_JWT
      ? new Date(Date.now() + 30 * 86400 * 1000)
      : null;

    const row = await this.prisma.client.licenseState.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        instanceId,
        licenseKeyHash,
        plan: entitlements.plan,
        status: LicenseStatus.active,
        entitlements: entitlements as object,
        validUntil,
        lastSyncAt: new Date(),
      },
      update: {
        licenseKeyHash: licenseKeyHash ?? existing?.licenseKeyHash ?? null,
        plan: entitlements.plan,
        status: LicenseStatus.active,
        entitlements: entitlements as object,
        validUntil,
        lastSyncAt: new Date(),
      },
    });

    this.cached = this.toSummary(row, Boolean(env.LICENSE_KEY));
  }

  private toSummary(
    row: {
      instanceId: string;
      plan: string;
      status: LicenseStatus;
      entitlements: unknown;
      validUntil: Date | null;
      lastSyncAt: Date | null;
    },
    licenseKeyConfigured: boolean,
  ): LicenseSummary {
    const env = loadEnv();
    return {
      instanceId: row.instanceId,
      plan: row.plan,
      status: row.status,
      entitlements: row.entitlements as Entitlements,
      validUntil: row.validUntil?.toISOString() ?? null,
      lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
      licenseKeyConfigured,
      cloudConnected: Boolean(env.LICENSE_SERVER_URL),
      lastSyncError: this.lastSyncError,
      billing: this.cachedBilling,
    };
  }

  async getSummary(): Promise<LicenseSummary> {
    if (this.cached) return this.cached;
    const row = await this.prisma.client.licenseState.findUnique({ where: { id: "default" } });
    if (!row) {
      await this.bootstrapFromEnv();
      return this.getSummary();
    }
    const env = loadEnv();
    this.cached = this.toSummary(row, Boolean(env.LICENSE_KEY));
    return this.cached;
  }

  async getEntitlements(): Promise<Entitlements> {
    const summary = await this.getSummary();
    this.assertActive(summary.status, summary.validUntil, summary.lastSyncAt);
    return summary.entitlements;
  }

  assertActive(status: LicenseStatus, validUntil: string | null, lastSyncAt: string | null) {
    if (status === LicenseStatus.suspended) throw new Error("LICENSE_SUSPENDED");
    if (status === LicenseStatus.expired) throw new Error("LICENSE_EXPIRED");
    if (validUntil && new Date(validUntil).getTime() < Date.now()) throw new Error("LICENSE_EXPIRED");

    const env = loadEnv();
    if (env.LICENSE_SERVER_URL && lastSyncAt) {
      const stale = Date.now() - new Date(lastSyncAt).getTime() > GRACE_MS;
      if (stale && status === LicenseStatus.grace) throw new Error("LICENSE_GRACE_EXPIRED");
    }
  }

  private async collectMetrics(): Promise<HeartbeatMetrics> {
    const period = new Date().toISOString().slice(0, 7);
    const [servers, sites, apiKeys, members, jobsCounter, aiCounter] = await Promise.all([
      this.prisma.client.server.count({ where: { deletedAt: null } }),
      this.prisma.client.site.count({ where: { deletedAt: null } }),
      this.prisma.client.apiKey.count({ where: { revokedAt: null } }),
      this.prisma.client.organizationMember.count(),
      this.prisma.client.usageCounter.findUnique({
        where: { metric_period: { metric: "jobs_month", period } },
      }),
      this.prisma.client.usageCounter.findUnique({
        where: { metric_period: { metric: "ai_calls", period } },
      }),
    ]);
    return {
      servers,
      sites,
      jobs_month: jobsCounter?.count ?? 0,
      api_keys: apiKeys,
      members,
      ai_calls: aiCounter?.count ?? 0,
    };
  }

  private async applyCloudResponse(response: {
    plan: string;
    status: string;
    entitlements?: Entitlements;
    entitlementsJwt: string;
    validUntil: string;
    billing?: LicenseSummary["billing"];
  }) {
    const env = loadEnv();
    let entitlements: Entitlements;
    if (env.LICENSE_SIGNING_SECRET && response.entitlementsJwt) {
      entitlements = verifyEntitlementsJwt(response.entitlementsJwt, env.LICENSE_SIGNING_SECRET);
    } else if (response.entitlements?.plan) {
      // Install self-serve: confia no HTTPS do License Cloud sem compartilhar o secret HMAC.
      entitlements = response.entitlements;
    } else {
      throw new Error(
        "License Cloud não retornou entitlements e LICENSE_SIGNING_SECRET não está configurado.",
      );
    }
    const status =
      response.status === "active"
        ? LicenseStatus.active
        : response.status === "suspended"
          ? LicenseStatus.suspended
          : LicenseStatus.expired;

    const row = await this.prisma.client.licenseState.update({
      where: { id: "default" },
      data: {
        plan: entitlements.plan,
        status,
        entitlements: entitlements as object,
        validUntil: new Date(response.validUntil),
        lastSyncAt: new Date(),
      },
    });
    this.lastSyncError = null;
    this.cachedBilling = response.billing;
    this.cached = this.toSummary(row, Boolean(env.LICENSE_KEY));
    return this.cached;
  }

  async getBillingPlans() {
    const client = LicenseCloudClient.fromEnv();
    if (!client) throw new Error("License Cloud não configurado.");
    const result = await client.getBillingPlans();
    return {
      ...result,
      plans: result.plans.filter((p) => p.id !== "full_free"),
    };
  }

  async createBillingCheckout(plan: "pro" | "business", urls?: { successUrl?: string; cancelUrl?: string }) {
    const client = LicenseCloudClient.fromEnv();
    const env = loadEnv();
    if (!client || !env.LICENSE_KEY) throw new Error("LICENSE_KEY e License Cloud são obrigatórios.");
    const webUrl = env.WEB_URL.replace(/\/$/, "");
    return client.createCheckout({
      licenseKey: env.LICENSE_KEY,
      plan,
      successUrl: urls?.successUrl ?? `${webUrl}/settings/plan?billing=success&plan=${plan}`,
      cancelUrl: urls?.cancelUrl ?? `${webUrl}/settings/plan?billing=cancel`,
    });
  }

  async createBillingPortal(returnUrl?: string) {
    const client = LicenseCloudClient.fromEnv();
    const env = loadEnv();
    if (!client || !env.LICENSE_KEY) throw new Error("LICENSE_KEY e License Cloud são obrigatórios.");
    const webUrl = env.WEB_URL.replace(/\/$/, "");
    return client.createPortal({
      licenseKey: env.LICENSE_KEY,
      returnUrl: returnUrl ?? `${webUrl}/settings/plan`,
    });
  }

  async syncWithCloud(mode: "activate" | "heartbeat" = "heartbeat") {
    const client = LicenseCloudClient.fromEnv();
    const env = loadEnv();
    if (!client || !env.LICENSE_KEY) return null;

    const summary = await this.getSummary();
    const metrics = await this.collectMetrics();
    const period = new Date().toISOString().slice(0, 7);

    const payload = {
      licenseKey: env.LICENSE_KEY,
      instanceId: summary.instanceId,
      version: env.APP_VERSION,
      hostname: hostname(),
    };

    const response =
      mode === "activate"
        ? await client.activate(payload)
        : await client.heartbeat({ ...payload, period, metrics });

    return this.applyCloudResponse(response);
  }

  async activateLicenseKey(licenseKey: string, _entitlementsJwt?: string) {
    if (!isLicenseKeyFormat(licenseKey)) {
      throw new Error("Chave de licença inválida. Deve começar com oplic_.");
    }

    process.env.LICENSE_KEY = licenseKey;
    try {
      patchEnvFile("LICENSE_KEY", licenseKey);
    } catch (err) {
      this.logger.warn(
        `Não foi possível gravar LICENSE_KEY no .env: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    this.cached = null;

    await this.prisma.client.licenseState.update({
      where: { id: "default" },
      data: { licenseKeyHash: this.hashKey(licenseKey) },
    });

    const client = LicenseCloudClient.fromEnv();
    if (!client) {
      throw new Error("License Cloud não configurado (LICENSE_SERVER_URL ausente no .env).");
    }

    try {
      const synced = await this.syncWithCloud("activate");
      if (synced) return synced;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/INSTANCE|Instância|vinculada/i.test(msg)) {
        this.logger.warn("Conflito de instância; gerando novo instanceId para a nova licença.");
        await this.prisma.client.licenseState.update({
          where: { id: "default" },
          data: { instanceId: randomUUID() },
        });
        this.cached = null;
        const retried = await this.syncWithCloud("activate");
        if (retried) return retried;
      }
      throw new Error(this.formatLicenseCloudError(msg));
    }

    throw new Error("Não foi possível ativar a licença no License Cloud.");
  }

  private formatLicenseCloudError(msg: string): string {
    if (/LICENSE_NOT_FOUND|inválida|not found/i.test(msg)) {
      return "Licença não encontrada. Verifique se a chave foi copiada corretamente.";
    }
    if (/INACTIVE|suspensa|revogada/i.test(msg)) {
      return "Licença suspensa ou revogada. Contate o administrador.";
    }
    if (/Invalid plan/i.test(msg)) {
      return "Plano da licença não reconhecido. Atualize o OpsPanel para a versão mais recente.";
    }
    if (/signature|JWT signature|signing/i.test(msg)) {
      return "Erro de assinatura da licença. Atualize o OpsPanel ou contate o suporte.";
    }
    if (/INSTANCE|Instância|vinculada/i.test(msg)) {
      return "Esta instância já está vinculada a outra licença. Tente novamente ou contate o suporte.";
    }
    return msg;
  }
}
