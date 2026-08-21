import { Prisma, prisma } from "@opspanel/database";
import { createLogger } from "@opspanel/observability";

const logger = createLogger("worker-alerts");

type NotifyPayload = {
  kind: "job_failed" | "security_critical" | "test";
  title: string;
  body?: string;
  organizationId: string;
  metadata?: Record<string, unknown>;
};

async function deliverWebhook(url: string, payload: Record<string, unknown>) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "OpsPanel-Alerts/1.0" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Webhook HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
}

/** Melhor esforço: nunca lança para o caller. */
export async function notifyOrganization(payload: NotifyPayload): Promise<void> {
  try {
    const channels = await prisma.alertChannel.findMany({
      where: { organizationId: payload.organizationId, enabled: true },
    });
    if (!channels.length) return;

    for (const channel of channels) {
      const bodyPayload = {
        text: `*${payload.title}*\n${payload.body ?? ""}`,
        title: payload.title,
        body: payload.body,
        kind: payload.kind,
        metadata: payload.metadata ?? {},
        channel: channel.name,
        source: "opspanel",
      };

      let status = "sent";
      let errorMessage: string | null = null;

      try {
        if (channel.type === "email") {
          status = "skipped";
          errorMessage = channel.emailTo
            ? `E-mail para ${channel.emailTo} registrado (SMTP não configurado no MVP).`
            : "emailTo ausente";
        } else if (channel.webhookUrl) {
          await deliverWebhook(channel.webhookUrl, bodyPayload);
        } else {
          status = "failed";
          errorMessage = "webhookUrl ausente";
        }
      } catch (err) {
        status = "failed";
        errorMessage = err instanceof Error ? err.message : "Falha no envio";
      }

      await prisma.alertEvent.create({
        data: {
          organizationId: channel.organizationId,
          channelId: channel.id,
          kind: payload.kind,
          title: payload.title,
          body: payload.body,
          payload: bodyPayload as Prisma.InputJsonValue,
          status,
          errorMessage,
        },
      });
    }
  } catch (err) {
    logger.warn({ err }, "Falha ao notificar canais de alerta");
  }
}

export async function notifyJobFailed(jobId: string, message: string): Promise<void> {
  try {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        organizationId: true,
        operationKey: true,
        serverId: true,
        server: { select: { name: true, host: true } },
      },
    });
    if (!job) return;

    await notifyOrganization({
      kind: "job_failed",
      organizationId: job.organizationId,
      title: `Job falhou: ${job.operationKey}`,
      body: [
        message.slice(0, 500),
        job.server ? `Servidor: ${job.server.name} (${job.server.host})` : null,
        `Job: ${job.id}`,
      ]
        .filter(Boolean)
        .join("\n"),
      metadata: {
        jobId: job.id,
        operationKey: job.operationKey,
        serverId: job.serverId,
      },
    });
  } catch (err) {
    logger.warn({ jobId, err }, "notifyJobFailed falhou");
  }
}
