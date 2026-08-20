import { ForbiddenException, Injectable } from "@nestjs/common";
import { isWithinLimit, type Entitlements } from "@opspanel/licensing";
import { PrismaService } from "../prisma/prisma.service";
import { LicenseService } from "./license.service";

export type UsageMetric =
  | "servers"
  | "sites"
  | "jobs_month"
  | "api_keys"
  | "members"
  | "ai_calls";

export type UsageSnapshot = {
  plan: string;
  entitlements: Entitlements;
  usage: Record<UsageMetric, number>;
  limits: Record<UsageMetric, number | null>;
};

function currentPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

@Injectable()
export class QuotasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly license: LicenseService,
  ) {}

  private quotaError(code: string, message: string, meta?: Record<string, unknown>): never {
    throw new ForbiddenException({
      error: { code, message, ...meta },
    });
  }

  async getUsageSnapshot(): Promise<UsageSnapshot> {
    const entitlements = await this.license.getEntitlements();
    const period = currentPeriod();

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
      plan: entitlements.plan,
      entitlements,
      usage: {
        servers,
        sites,
        jobs_month: jobsCounter?.count ?? 0,
        api_keys: apiKeys,
        members,
        ai_calls: aiCounter?.count ?? 0,
      },
      limits: {
        servers: entitlements.maxServers,
        sites: entitlements.maxSites,
        jobs_month: entitlements.maxJobsPerMonth,
        api_keys: entitlements.maxApiKeys,
        members: entitlements.maxMembers,
        ai_calls: entitlements.aiAssistant ? null : 0,
      },
    };
  }

  async assertCanCreateServer() {
    const snap = await this.getUsageSnapshot();
    if (!isWithinLimit(snap.usage.servers, snap.limits.servers)) {
      this.quotaError("QUOTA_EXCEEDED", "Limite de servidores do plano atingido.", {
        limit: snap.limits.servers,
        usage: snap.usage.servers,
        plan: snap.plan,
      });
    }
  }

  async assertCanCreateSite() {
    const snap = await this.getUsageSnapshot();
    if (!isWithinLimit(snap.usage.sites, snap.limits.sites)) {
      this.quotaError("QUOTA_EXCEEDED", "Limite de sites do plano atingido.", {
        limit: snap.limits.sites,
        usage: snap.usage.sites,
        plan: snap.plan,
      });
    }
  }

  async assertCanCreateJob() {
    const snap = await this.getUsageSnapshot();
    if (!isWithinLimit(snap.usage.jobs_month, snap.limits.jobs_month)) {
      this.quotaError("QUOTA_EXCEEDED", "Limite mensal de jobs do plano atingido.", {
        limit: snap.limits.jobs_month,
        usage: snap.usage.jobs_month,
        plan: snap.plan,
      });
    }
  }

  async assertCanCreateApiKey() {
    const snap = await this.getUsageSnapshot();
    if (!isWithinLimit(snap.usage.api_keys, snap.limits.api_keys)) {
      this.quotaError("QUOTA_EXCEEDED", "Limite de API keys do plano atingido.", {
        limit: snap.limits.api_keys,
        usage: snap.usage.api_keys,
        plan: snap.plan,
      });
    }
  }

  async assertAiAssistantEnabled() {
    const entitlements = await this.license.getEntitlements();
    if (!entitlements.aiAssistant) {
      this.quotaError("PLAN_FEATURE_DISABLED", "Assistente IA não disponível no plano atual.", {
        plan: entitlements.plan,
      });
    }
  }

  async getEmailUsageSnapshot() {
    const entitlements = await this.license.getEntitlements();
    const [mailboxes, emailDomains] = await Promise.all([
      this.prisma.client.emailMailbox.count(),
      this.prisma.client.emailDomain.count(),
    ]);
    return {
      plan: entitlements.plan,
      usage: { mailboxes, email_domains: emailDomains },
      limits: {
        mailboxes: entitlements.maxMailboxes,
        email_domains: entitlements.maxEmailDomains,
        email_delivery_monthly: entitlements.emailDeliveryMonthly,
      },
    };
  }

  async assertCanCreateMailbox() {
    const snap = await this.getEmailUsageSnapshot();
    if (!isWithinLimit(snap.usage.mailboxes, snap.limits.mailboxes)) {
      const message =
        snap.limits.mailboxes === 0
          ? "Nenhuma caixa de e-mail contratada nesta licença. Solicite a contratação ao administrador do OpsPanel."
          : "Limite de caixas de e-mail contratadas atingido.";
      this.quotaError("QUOTA_EXCEEDED", message, {
        limit: snap.limits.mailboxes,
        usage: snap.usage.mailboxes,
        plan: snap.plan,
      });
    }
  }

  async assertCanCreateEmailDomain() {
    const snap = await this.getEmailUsageSnapshot();
    if (!isWithinLimit(snap.usage.email_domains, snap.limits.email_domains)) {
      const message =
        snap.limits.email_domains === 0
          ? "Nenhum domínio de e-mail contratado nesta licença. Solicite a contratação ao administrador do OpsPanel."
          : "Limite de domínios de e-mail contratados atingido.";
      this.quotaError("QUOTA_EXCEEDED", message, {
        limit: snap.limits.email_domains,
        usage: snap.usage.email_domains,
        plan: snap.plan,
      });
    }
  }

  async incrementMetric(metric: UsageMetric, amount = 1) {
    const period = currentPeriod();
    await this.prisma.client.usageCounter.upsert({
      where: { metric_period: { metric, period } },
      create: { metric, period, count: amount },
      update: { count: { increment: amount } },
    });
  }
}
