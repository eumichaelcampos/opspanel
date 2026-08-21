import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  OperationKeys,
  PLAYBOOKS,
  getPlaybookById,
  playbookRunInputSchema,
  type PlaybookListResponse,
  type PlaybookRunResponse,
} from "@opspanel/contracts";
import { PrismaService } from "../prisma/prisma.service";
import { SessionUser } from "../auth/auth.guard";
import { JobsService } from "../jobs/jobs.service";
import { AuditService } from "../audit/audit.service";

function canManage(user: SessionUser) {
  return user.role === "owner" || user.role === "admin" || user.role === "operator";
}

@Injectable()
export class PlaybooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly audit: AuditService,
  ) {}

  list(): PlaybookListResponse {
    return { playbooks: PLAYBOOKS };
  }

  async run(user: SessionUser, playbookId: string, body: unknown, ip?: string): Promise<PlaybookRunResponse> {
    if (!canManage(user)) {
      throw new ForbiddenException({ error: { code: "FORBIDDEN", message: "Sem permissão." } });
    }

    const playbook = getPlaybookById(playbookId);
    if (!playbook) {
      throw new NotFoundException({ error: { code: "NOT_FOUND", message: "Playbook não encontrado." } });
    }

    const parsed = playbookRunInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: { code: "VALIDATION_ERROR", message: "serverId inválido.", details: parsed.error.flatten() },
      });
    }

    const server = await this.prisma.client.server.findFirst({
      where: { id: parsed.data.serverId, organizationId: user.organizationId, deletedAt: null },
    });
    if (!server) {
      throw new NotFoundException({ error: { code: "NOT_FOUND", message: "Servidor não encontrado." } });
    }

    const job = await this.jobs.createOperationJob({
      organizationId: user.organizationId,
      requestedById: user.id,
      serverId: server.id,
      operationKey: OperationKeys.ServerPlaybookRun,
      input: { serverId: server.id, playbookId: playbook.id },
      idempotencyKey: `playbook:${playbook.id}:${server.id}:${Date.now()}`,
    });

    await this.audit.log({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: `playbook.${playbook.id}.requested`,
      targetType: "server",
      targetId: server.id,
      result: "success",
      ipAddress: ip,
      metadata: { jobId: job.id, steps: playbook.steps.length },
    });

    return { jobId: job.id, playbookId: playbook.id, serverId: server.id };
  }
}
