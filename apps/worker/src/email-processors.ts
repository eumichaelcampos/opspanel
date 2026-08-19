import { EmailDomainStatus, JobStatus, prisma } from "@opspanel/database";
import { loadEnv } from "@opspanel/config";
import {
  atriomailConfigured,
  atriomailCreateMailbox,
  atriomailDeleteMailbox,
  atriomailProvisionDomain,
  checkEmailHealth,
  type AtriomailConfig,
} from "@opspanel/email-providers";
import { appendEvent, claimJob } from "./job-utils.js";

function atriomailConfig(): AtriomailConfig | null {
  const env = loadEnv();
  if (env.EMAIL_PROVIDER === "none") return null;
  const apiKey = env.ATRIOMAIL_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiUrl: env.ATRIOMAIL_API_URL || "https://api.atriomail.com",
    apiKey,
    mxHost: env.ATRIOMAIL_MX_HOST || "mail.atriomail.com",
    spfInclude: env.ATRIOMAIL_SPF_INCLUDE || "spf.atriomail.com",
    webmailBaseUrl: env.EMAIL_WEBMAIL_BASE_URL,
  };
}

async function failJob(jobId: string, message: string) {
  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.failed,
      progress: 100,
      currentStep: "failed",
      finishedAt: new Date(),
      errorMessage: message.slice(0, 500),
    },
  });
  await appendEvent(jobId, 99, "error", message.slice(0, 500), 100);
}

export async function processSiteEmailDomainProvision(jobId: string) {
  const job = await claimJob(jobId);
  if (!job) return;
  const input = (job.inputJson ?? {}) as { siteId?: string; emailDomainId?: string };
  if (!input.emailDomainId) {
    await failJob(jobId, "emailDomainId ausente.");
    return;
  }
  const cfg = atriomailConfig();
  if (!atriomailConfigured(cfg ?? {})) {
    await failJob(jobId, "ATRIOMAIL_API_KEY não configurada.");
    await prisma.emailDomain.update({
      where: { id: input.emailDomainId },
      data: { status: EmailDomainStatus.error, errorMessage: "Provedor de e-mail não configurado." },
    });
    return;
  }

  const emailDomain = await prisma.emailDomain.findUnique({ where: { id: input.emailDomainId } });
  if (!emailDomain) {
    await failJob(jobId, "Domínio de e-mail não encontrado.");
    return;
  }

  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.running, startedAt: new Date(), currentStep: "provision", progress: 20 },
  });
  await appendEvent(jobId, 1, "progress", `Provisionando ${emailDomain.domain} no provedor…`, 20);

  try {
    const result = await atriomailProvisionDomain(cfg!, emailDomain.domain);
    await prisma.emailDomain.update({
      where: { id: emailDomain.id },
      data: {
        providerDomainId: result.providerDomainId,
        dnsBundle: result.dns as object,
        webmailUrl: result.webmailUrl,
        status: EmailDomainStatus.pending_dns,
        errorMessage: null,
      },
    });
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.succeeded,
        progress: 100,
        currentStep: "completed",
        finishedAt: new Date(),
        resultJson: { providerDomainId: result.providerDomainId },
      },
    });
    await appendEvent(jobId, 2, "progress", "Domínio provisionado. Publique o DNS no Cloudflare.", 100);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Falha ao provisionar domínio.";
    await prisma.emailDomain.update({
      where: { id: emailDomain.id },
      data: { status: EmailDomainStatus.error, errorMessage: message.slice(0, 500) },
    });
    await failJob(jobId, message);
  }
}

export async function processSiteEmailMailboxCreate(jobId: string) {
  const job = await claimJob(jobId);
  if (!job) return;
  const input = (job.inputJson ?? {}) as {
    emailDomainId?: string;
    localPart?: string;
    displayName?: string;
    quotaMb?: number;
    password?: string;
  };
  const cfg = atriomailConfig();
  if (!atriomailConfigured(cfg ?? {})) {
    await failJob(jobId, "ATRIOMAIL_API_KEY não configurada.");
    return;
  }
  const emailDomain = await prisma.emailDomain.findUnique({ where: { id: input.emailDomainId } });
  if (!emailDomain || !input.localPart) {
    await failJob(jobId, "Dados incompletos para criar caixa.");
    return;
  }

  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.running, startedAt: new Date(), currentStep: "mailbox", progress: 30 },
  });
  await appendEvent(jobId, 1, "progress", `Criando caixa ${input.localPart}@${emailDomain.domain}…`, 30);

  try {
    const created = await atriomailCreateMailbox(cfg!, {
      domain: emailDomain.domain,
      providerDomainId: emailDomain.providerDomainId ?? undefined,
      localPart: input.localPart,
      displayName: input.displayName,
      quotaMb: input.quotaMb ?? 10240,
      password: input.password,
    });
    await prisma.emailMailbox.create({
      data: {
        emailDomainId: emailDomain.id,
        localPart: input.localPart.toLowerCase(),
        displayName: input.displayName,
        quotaMb: input.quotaMb ?? 10240,
        providerMailboxId: created.providerMailboxId,
        webmailUrl: created.webmailUrl ?? emailDomain.webmailUrl,
        imapHost: created.imap?.host,
        smtpHost: created.smtp?.host,
        createdByUserId: job.requestedById,
        status: "active",
      },
    });
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.succeeded,
        progress: 100,
        currentStep: "completed",
        finishedAt: new Date(),
        resultJson: {
          email: created.email,
          generatedPassword: created.generatedPassword ?? null,
        },
      },
    });
    await appendEvent(jobId, 2, "progress", `Caixa ${created.email} criada.`, 100);
  } catch (err) {
    await failJob(jobId, err instanceof Error ? err.message : "Falha ao criar caixa.");
  }
}

export async function processSiteEmailMailboxDelete(jobId: string) {
  const job = await claimJob(jobId);
  if (!job) return;
  const input = (job.inputJson ?? {}) as { mailboxId?: string };
  const mailbox = await prisma.emailMailbox.findUnique({
    where: { id: input.mailboxId },
    include: { emailDomain: true },
  });
  if (!mailbox) {
    await failJob(jobId, "Caixa não encontrada.");
    return;
  }
  const cfg = atriomailConfig();
  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.running, startedAt: new Date(), currentStep: "delete", progress: 40 },
  });
  try {
    if (mailbox.providerMailboxId && atriomailConfigured(cfg ?? {})) {
      await atriomailDeleteMailbox(cfg!, mailbox.providerMailboxId);
    }
    await prisma.emailMailbox.delete({ where: { id: mailbox.id } });
    await prisma.job.update({
      where: { id: jobId },
      data: { status: JobStatus.succeeded, progress: 100, currentStep: "completed", finishedAt: new Date() },
    });
    await appendEvent(jobId, 1, "progress", "Caixa removida.", 100);
  } catch (err) {
    await failJob(jobId, err instanceof Error ? err.message : "Falha ao excluir caixa.");
  }
}

export async function processSiteEmailHealthCheck(jobId: string) {
  const job = await claimJob(jobId);
  if (!job) return;
  const input = (job.inputJson ?? {}) as { emailDomainId?: string };
  const emailDomain = await prisma.emailDomain.findUnique({ where: { id: input.emailDomainId } });
  if (!emailDomain) {
    await failJob(jobId, "Domínio não encontrado.");
    return;
  }
  const bundle = emailDomain.dnsBundle as { mx?: { host: string }[] } | null;
  const expectedMx = bundle?.mx?.map((m) => m.host);
  const report = await checkEmailHealth(emailDomain.domain, expectedMx);
  await prisma.emailDomain.update({
    where: { id: emailDomain.id },
    data: {
      healthSnapshot: report as object,
      lastHealthAt: new Date(),
      status: report.mx === "ok" && report.spf !== "missing" ? EmailDomainStatus.active : EmailDomainStatus.pending_dns,
    },
  });
  await prisma.job.update({
    where: { id: jobId },
    data: { status: JobStatus.succeeded, progress: 100, currentStep: "completed", finishedAt: new Date(), resultJson: report as object },
  });
  await appendEvent(jobId, 1, "progress", "Verificação de e-mail concluída.", 100);
}
