import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  alertChannelCreateSchema,
  alertChannelUpdateSchema,
  type AlertChannelDto,
  type AlertEventDto,
  type AlertNotifyPayload,
  type AlertsHubResponse,
} from "@opspanel/contracts";
import { Prisma } from "@opspanel/database";
import { PrismaService } from "../prisma/prisma.service";
import { SessionUser } from "../auth/auth.guard";

function canManage(user: SessionUser) {
  return user.role === "owner" || user.role === "admin" || user.role === "operator";
}

function toChannelDto(row: {
  id: string;
  name: string;
  type: string;
  webhookUrl: string | null;
  emailTo: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}): AlertChannelDto {
  return {
    id: row.id,
    name: row.name,
    type: row.type as AlertChannelDto["type"],
    webhookUrl: row.webhookUrl,
    emailTo: row.emailTo,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toEventDto(row: {
  id: string;
  channelId: string | null;
  kind: string;
  title: string;
  body: string | null;
  status: string;
  errorMessage: string | null;
  createdAt: Date;
}): AlertEventDto {
  return {
    id: row.id,
    channelId: row.channelId,
    kind: row.kind,
    title: row.title,
    body: row.body,
    status: row.status,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
  };
}

async function deliverWebhook(url: string, payload: Record<string, unknown>): Promise<void> {
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

@Injectable()
export class AlertsService {
  constructor(private readonly prisma: PrismaService) {}

  async getHub(user: SessionUser): Promise<AlertsHubResponse> {
    const [channels, events] = await Promise.all([
      this.prisma.client.alertChannel.findMany({
        where: { organizationId: user.organizationId },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.client.alertEvent.findMany({
        where: { organizationId: user.organizationId },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
    ]);
    return {
      channels: channels.map(toChannelDto),
      recentEvents: events.map(toEventDto),
    };
  }

  async createChannel(user: SessionUser, body: unknown) {
    if (!canManage(user)) {
      throw new ForbiddenException({ error: { code: "FORBIDDEN", message: "Sem permissão." } });
    }
    const parsed = alertChannelCreateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: { code: "VALIDATION_ERROR", message: "Canal inválido.", details: parsed.error.flatten() },
      });
    }
    const row = await this.prisma.client.alertChannel.create({
      data: {
        organizationId: user.organizationId,
        name: parsed.data.name,
        type: parsed.data.type,
        webhookUrl: parsed.data.webhookUrl,
        emailTo: parsed.data.emailTo,
        enabled: parsed.data.enabled ?? true,
      },
    });
    return toChannelDto(row);
  }

  async updateChannel(user: SessionUser, channelId: string, body: unknown) {
    if (!canManage(user)) {
      throw new ForbiddenException({ error: { code: "FORBIDDEN", message: "Sem permissão." } });
    }
    const existing = await this.prisma.client.alertChannel.findFirst({
      where: { id: channelId, organizationId: user.organizationId },
    });
    if (!existing) {
      throw new NotFoundException({ error: { code: "NOT_FOUND", message: "Canal não encontrado." } });
    }
    const parsed = alertChannelUpdateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: { code: "VALIDATION_ERROR", message: "Atualização inválida.", details: parsed.error.flatten() },
      });
    }
    const row = await this.prisma.client.alertChannel.update({
      where: { id: channelId },
      data: {
        name: parsed.data.name,
        webhookUrl: parsed.data.webhookUrl === undefined ? undefined : parsed.data.webhookUrl,
        emailTo: parsed.data.emailTo === undefined ? undefined : parsed.data.emailTo,
        enabled: parsed.data.enabled,
      },
    });
    return toChannelDto(row);
  }

  async deleteChannel(user: SessionUser, channelId: string) {
    if (!canManage(user)) {
      throw new ForbiddenException({ error: { code: "FORBIDDEN", message: "Sem permissão." } });
    }
    const existing = await this.prisma.client.alertChannel.findFirst({
      where: { id: channelId, organizationId: user.organizationId },
    });
    if (!existing) {
      throw new NotFoundException({ error: { code: "NOT_FOUND", message: "Canal não encontrado." } });
    }
    await this.prisma.client.alertChannel.delete({ where: { id: channelId } });
    return { ok: true };
  }

  async testChannel(user: SessionUser, channelId: string) {
    if (!canManage(user)) {
      throw new ForbiddenException({ error: { code: "FORBIDDEN", message: "Sem permissão." } });
    }
    const channel = await this.prisma.client.alertChannel.findFirst({
      where: { id: channelId, organizationId: user.organizationId },
    });
    if (!channel) {
      throw new NotFoundException({ error: { code: "NOT_FOUND", message: "Canal não encontrado." } });
    }

    const result = await this.deliverToChannel(channel, {
      kind: "test",
      title: "Teste OpsPanel",
      body: `Canal "${channel.name}" recebeu um alerta de teste.`,
      organizationId: user.organizationId,
      metadata: { source: "manual_test" },
    });

    return result;
  }

  /** Melhor esforço: usado pela API e espelhado no worker. */
  async notifyOrganization(payload: AlertNotifyPayload) {
    const channels = await this.prisma.client.alertChannel.findMany({
      where: { organizationId: payload.organizationId, enabled: true },
    });
    const results = [];
    for (const ch of channels) {
      results.push(await this.deliverToChannel(ch, payload));
    }
    return { sent: results.filter((r) => r.status === "sent").length, results };
  }

  private async deliverToChannel(
    channel: {
      id: string;
      organizationId: string;
      type: string;
      webhookUrl: string | null;
      emailTo: string | null;
      name: string;
    },
    payload: AlertNotifyPayload,
  ) {
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
          ? `E-mail para ${channel.emailTo} registrado (envio SMTP ainda não configurado no MVP).`
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

    const event = await this.prisma.client.alertEvent.create({
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

    return { channelId: channel.id, status, eventId: event.id, errorMessage };
  }
}
