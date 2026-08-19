import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { EmailDomainStatus, OrgRole, Prisma } from "@opspanel/database";
import {
  emailMailboxCreateSchema,
  emailSmtpProfileSchema,
  emailSmtpTestSchema,
  OperationKeys,
  type EmailDnsBundle,
  type EmailHealthReport,
} from "@opspanel/contracts";
import { loadEnv } from "@opspanel/config";
import {
  atriomailConfigured,
  checkEmailHealth,
  resendConfigured,
  resendEnsureDomain,
  resendSendTest,
  type AtriomailConfig,
} from "@opspanel/email-providers";
import type { SessionUser } from "../auth/auth.service";
import { JobsService } from "../jobs/jobs.service";
import { QuotasService } from "../license/quotas.service";
import { PrismaService } from "../prisma/prisma.service";
import { EmailDnsService } from "./email-dns.service";

function canManage(user: SessionUser) {
  return user.role === OrgRole.owner || user.role === OrgRole.admin || user.role === OrgRole.operator;
}

@Injectable()
export class EmailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly quotas: QuotasService,
    private readonly emailDns: EmailDnsService,
  ) {}

  private atriomailConfig(): AtriomailConfig | null {
    const env = loadEnv();
    if (env.EMAIL_PROVIDER === "none") return null;
    const apiUrl = env.ATRIOMAIL_API_URL || "https://api.atriomail.com";
    const apiKey = env.ATRIOMAIL_API_KEY?.trim();
    if (!apiKey) return null;
    return {
      apiUrl,
      apiKey,
      mxHost: env.ATRIOMAIL_MX_HOST || "mail.atriomail.com",
      spfInclude: env.ATRIOMAIL_SPF_INCLUDE || "spf.atriomail.com",
      webmailBaseUrl: env.EMAIL_WEBMAIL_BASE_URL,
    };
  }

  private providerStatus() {
    const env = loadEnv();
    const atriomail = atriomailConfigured(this.atriomailConfig() ?? {});
    const resend = resendConfigured({ apiKey: env.RESEND_API_KEY });
    return {
      mailboxProvider: env.EMAIL_PROVIDER,
      mailboxConfigured: atriomail,
      deliveryProvider: env.EMAIL_DELIVERY_PROVIDER,
      deliveryConfigured: resend,
    };
  }

  async getOrgHub(user: SessionUser) {
    const [domains, snap] = await Promise.all([
      this.prisma.client.emailDomain.findMany({
        where: { organizationId: user.organizationId },
        include: {
          site: { select: { id: true, domain: true } },
          mailboxes: { select: { id: true, localPart: true, status: true } },
        },
        orderBy: { domain: "asc" },
      }),
      this.quotas.getEmailUsageSnapshot(),
    ]);
    return {
      provider: this.providerStatus(),
      quotas: snap,
      domains: domains.map((d) => ({
        id: d.id,
        domain: d.domain,
        status: d.status,
        site: d.site,
        mailboxCount: d.mailboxes.length,
        errorMessage: d.errorMessage,
      })),
    };
  }

  async getSiteEmail(user: SessionUser, siteId: string) {
    const site = await this.requireSite(user, siteId);
    const emailDomain = await this.prisma.client.emailDomain.findUnique({
      where: { siteId: site.id },
      include: { mailboxes: { orderBy: { localPart: "asc" } } },
    });
    const smtp = await this.prisma.client.emailSmtpProfile.findUnique({ where: { siteId: site.id } });
    const snap = await this.quotas.getEmailUsageSnapshot();
    const health = emailDomain?.healthSnapshot as EmailHealthReport | undefined;
    return {
      site: { id: site.id, domain: site.domain },
      provider: this.providerStatus(),
      quotas: snap,
      cloudflareRequired: true,
      emailDomain: emailDomain
        ? {
            id: emailDomain.id,
            domain: emailDomain.domain,
            status: emailDomain.status,
            webmailUrl: emailDomain.webmailUrl,
            errorMessage: emailDomain.errorMessage,
            mailboxes: emailDomain.mailboxes.map((m) => ({
              id: m.id,
              email: `${m.localPart}@${emailDomain.domain}`,
              localPart: m.localPart,
              displayName: m.displayName,
              quotaMb: m.quotaMb,
              status: m.status,
              webmailUrl: m.webmailUrl,
              imapHost: m.imapHost,
              smtpHost: m.smtpHost,
            })),
            health,
            lastHealthAt: emailDomain.lastHealthAt,
          }
        : null,
      smtp: smtp
        ? {
            fromAddress: smtp.fromAddress,
            fromName: smtp.fromName,
            provider: smtp.provider,
            wpConfigured: smtp.wpConfigured,
          }
        : null,
    };
  }

  async getSiteHealth(user: SessionUser, siteId: string, refresh = false) {
    const site = await this.requireSite(user, siteId);
    const emailDomain = await this.prisma.client.emailDomain.findUnique({ where: { siteId: site.id } });
    const bundle = emailDomain?.dnsBundle as EmailDnsBundle | null;
    const expectedMx = bundle?.mx.map((m) => m.host);
    const report = await checkEmailHealth(site.domain, expectedMx);
    if (emailDomain && refresh) {
      await this.prisma.client.emailDomain.update({
        where: { id: emailDomain.id },
        data: {
          healthSnapshot: report as unknown as Prisma.InputJsonValue,
          lastHealthAt: new Date(),
          status:
            report.mx === "ok" && report.spf !== "missing"
              ? EmailDomainStatus.active
              : emailDomain.status === EmailDomainStatus.draft
                ? EmailDomainStatus.pending_dns
                : emailDomain.status,
        },
      });
    }
    return report;
  }

  async activateSiteEmail(user: SessionUser, siteId: string) {
    if (!canManage(user)) throw new ForbiddenException({ error: { code: "FORBIDDEN", message: "Sem permissão." } });
    const cfg = this.atriomailConfig();
    if (!atriomailConfigured(cfg ?? {})) {
      throw new BadRequestException({
        error: {
          code: "EMAIL_PROVIDER_NOT_CONFIGURED",
          message: "Provedor de e-mail não configurado no servidor (ATRIOMAIL_API_KEY).",
        },
      });
    }
    await this.quotas.assertCanCreateEmailDomain();
    const site = await this.requireSite(user, siteId);
    const existing = await this.prisma.client.emailDomain.findUnique({ where: { siteId: site.id } });
    if (existing) return { emailDomainId: existing.id, jobId: null, status: existing.status };

    const row = await this.prisma.client.emailDomain.create({
      data: {
        organizationId: user.organizationId,
        siteId: site.id,
        domain: site.domain.toLowerCase(),
        status: EmailDomainStatus.draft,
      },
    });

    const job = await this.jobs.createOperationJob({
      organizationId: user.organizationId,
      requestedById: user.id,
      serverId: site.serverId,
      operationKey: OperationKeys.SiteEmailDomainProvision,
      input: { siteId: site.id, emailDomainId: row.id },
      idempotencyKey: `email-domain:${row.id}`,
    });

    return { emailDomainId: row.id, jobId: job.id, status: row.status };
  }

  async syncSiteDns(user: SessionUser, siteId: string) {
    if (!canManage(user)) throw new ForbiddenException({ error: { code: "FORBIDDEN", message: "Sem permissão." } });
    const site = await this.requireSite(user, siteId);
    const emailDomain = await this.prisma.client.emailDomain.findUnique({ where: { siteId: site.id } });
    if (!emailDomain?.dnsBundle) {
      throw new BadRequestException({
        error: { code: "EMAIL_DNS_MISSING", message: "Domínio de e-mail ainda não foi provisionado no provedor." },
      });
    }
    const bundle = emailDomain.dnsBundle as EmailDnsBundle;
    const result = await this.emailDns.publishBundle(user.id, site.domain, bundle);
    const health = await checkEmailHealth(site.domain, bundle.mx.map((m) => m.host));
    await this.prisma.client.emailDomain.update({
      where: { id: emailDomain.id },
      data: {
        status: health.mx === "ok" ? EmailDomainStatus.active : EmailDomainStatus.pending_dns,
        healthSnapshot: health as unknown as Prisma.InputJsonValue,
        lastHealthAt: new Date(),
      },
    });
    return { ...result, health };
  }

  async createMailbox(user: SessionUser, siteId: string, body: unknown) {
    if (!canManage(user)) throw new ForbiddenException({ error: { code: "FORBIDDEN", message: "Sem permissão." } });
    await this.quotas.assertCanCreateMailbox();
    const parsed = emailMailboxCreateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ error: { code: "VALIDATION_ERROR", message: "Dados inválidos." } });
    }
    const site = await this.requireSite(user, siteId);
    const emailDomain = await this.prisma.client.emailDomain.findUnique({ where: { siteId: site.id } });
    if (!emailDomain) {
      throw new BadRequestException({
        error: { code: "EMAIL_NOT_ACTIVE", message: "Ative o e-mail deste site primeiro." },
      });
    }

    const job = await this.jobs.createOperationJob({
      organizationId: user.organizationId,
      requestedById: user.id,
      serverId: site.serverId,
      operationKey: OperationKeys.SiteEmailMailboxCreate,
      input: {
        siteId: site.id,
        emailDomainId: emailDomain.id,
        ...parsed.data,
      },
    });
    return { jobId: job.id };
  }

  async deleteMailbox(user: SessionUser, siteId: string, mailboxId: string) {
    if (!canManage(user)) throw new ForbiddenException({ error: { code: "FORBIDDEN", message: "Sem permissão." } });
    const site = await this.requireSite(user, siteId);
    const mailbox = await this.prisma.client.emailMailbox.findFirst({
      where: { id: mailboxId, emailDomain: { siteId: site.id, organizationId: user.organizationId } },
    });
    if (!mailbox) throw new NotFoundException({ error: { code: "NOT_FOUND", message: "Caixa não encontrada." } });

    const job = await this.jobs.createOperationJob({
      organizationId: user.organizationId,
      requestedById: user.id,
      serverId: site.serverId,
      operationKey: OperationKeys.SiteEmailMailboxDelete,
      input: { siteId: site.id, mailboxId: mailbox.id },
    });
    return { jobId: job.id };
  }

  async upsertSmtpProfile(user: SessionUser, siteId: string, body: unknown) {
    if (!canManage(user)) throw new ForbiddenException({ error: { code: "FORBIDDEN", message: "Sem permissão." } });
    const parsed = emailSmtpProfileSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ error: { code: "VALIDATION_ERROR", message: "Dados inválidos." } });
    }
    const env = loadEnv();
    if (env.EMAIL_DELIVERY_PROVIDER === "resend" && !env.RESEND_API_KEY) {
      throw new BadRequestException({
        error: { code: "EMAIL_DELIVERY_NOT_CONFIGURED", message: "RESEND_API_KEY não configurada no servidor." },
      });
    }
    const site = await this.requireSite(user, siteId);
    if (!parsed.data.fromAddress.toLowerCase().endsWith(`@${site.domain.toLowerCase()}`)) {
      throw new BadRequestException({
        error: { code: "INVALID_FROM", message: `O remetente deve ser @${site.domain}.` },
      });
    }
    const emailDomain = await this.prisma.client.emailDomain.findUnique({ where: { siteId: site.id } });
    let providerRef: string | undefined;
    if (env.RESEND_API_KEY) {
      const ensured = await resendEnsureDomain({ apiKey: env.RESEND_API_KEY }, site.domain);
      providerRef = ensured.providerRef;
      if (ensured.dns && emailDomain) {
        await this.prisma.client.emailDomain.update({
          where: { id: emailDomain.id },
          data: { dnsBundle: ensured.dns as unknown as Prisma.InputJsonValue },
        });
      }
    }
    const row = await this.prisma.client.emailSmtpProfile.upsert({
      where: { siteId: site.id },
      create: {
        siteId: site.id,
        emailDomainId: emailDomain?.id,
        fromAddress: parsed.data.fromAddress,
        fromName: parsed.data.fromName,
        providerRef,
      },
      update: {
        fromAddress: parsed.data.fromAddress,
        fromName: parsed.data.fromName,
        emailDomainId: emailDomain?.id,
        providerRef,
      },
    });
    return { ok: true, smtp: row };
  }

  async testSmtp(user: SessionUser, siteId: string, body: unknown) {
    if (!canManage(user)) throw new ForbiddenException({ error: { code: "FORBIDDEN", message: "Sem permissão." } });
    const parsed = emailSmtpTestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ error: { code: "VALIDATION_ERROR", message: "E-mail de teste inválido." } });
    }
    const env = loadEnv();
    if (!env.RESEND_API_KEY) {
      throw new BadRequestException({
        error: { code: "EMAIL_DELIVERY_NOT_CONFIGURED", message: "RESEND_API_KEY não configurada." },
      });
    }
    const site = await this.requireSite(user, siteId);
    const smtp = await this.prisma.client.emailSmtpProfile.findUnique({ where: { siteId: site.id } });
    if (!smtp) {
      throw new BadRequestException({
        error: { code: "SMTP_NOT_CONFIGURED", message: "Configure o remetente transacional primeiro." },
      });
    }
    const from = smtp.fromName ? `${smtp.fromName} <${smtp.fromAddress}>` : smtp.fromAddress;
    const result = await resendSendTest({ apiKey: env.RESEND_API_KEY }, { from, to: parsed.data.to, domain: site.domain });
    return { ok: true, messageId: result.id };
  }

  async getProviderSettings(user: SessionUser) {
    if (user.role !== OrgRole.owner && user.role !== OrgRole.admin) {
      throw new ForbiddenException({ error: { code: "FORBIDDEN", message: "Apenas owner/admin." } });
    }
    return this.providerStatus();
  }

  /** Usado pelo worker após provisionamento */
  async completeDomainProvision(input: {
    emailDomainId: string;
    providerDomainId: string;
    dns: EmailDnsBundle;
    webmailUrl?: string;
  }) {
    await this.prisma.client.emailDomain.update({
      where: { id: input.emailDomainId },
      data: {
        providerDomainId: input.providerDomainId,
        dnsBundle: input.dns as unknown as Prisma.InputJsonValue,
        webmailUrl: input.webmailUrl,
        status: EmailDomainStatus.pending_dns,
        errorMessage: null,
      },
    });
  }

  async completeMailboxCreate(input: {
    emailDomainId: string;
    localPart: string;
    displayName?: string;
    quotaMb: number;
    providerMailboxId: string;
    email: string;
    webmailUrl?: string;
    imapHost?: string;
    smtpHost?: string;
    createdByUserId?: string;
  }) {
    await this.prisma.client.emailMailbox.create({
      data: {
        emailDomainId: input.emailDomainId,
        localPart: input.localPart,
        displayName: input.displayName,
        quotaMb: input.quotaMb,
        providerMailboxId: input.providerMailboxId,
        webmailUrl: input.webmailUrl,
        imapHost: input.imapHost,
        smtpHost: input.smtpHost,
        createdByUserId: input.createdByUserId,
        status: "active",
      },
    });
  }

  async markDomainError(emailDomainId: string, message: string) {
    await this.prisma.client.emailDomain.update({
      where: { id: emailDomainId },
      data: { status: EmailDomainStatus.error, errorMessage: message.slice(0, 500) },
    });
  }

  private async requireSite(user: SessionUser, siteId: string) {
    const site = await this.prisma.client.site.findFirst({
      where: { id: siteId, organizationId: user.organizationId, deletedAt: null },
    });
    if (!site) throw new NotFoundException({ error: { code: "SITE_NOT_FOUND", message: "Site não encontrado." } });
    return site;
  }
}
