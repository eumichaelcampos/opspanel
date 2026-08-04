import { Injectable, NotFoundException } from "@nestjs/common";
import { JobStatus, Prisma } from "@opspanel/database";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  async createOperationJob(params: {
    organizationId: string;
    requestedById: string;
    serverId?: string;
    operationKey: string;
    input: Record<string, unknown>;
    idempotencyKey?: string;
  }): Promise<{ id: string; status: JobStatus }> {
    const job = await this.prisma.client.job.create({
      data: {
        organizationId: params.organizationId,
        requestedById: params.requestedById,
        serverId: params.serverId,
        operationKey: params.operationKey,
        status: JobStatus.queued,
        inputJson: params.input as Prisma.InputJsonValue,
        idempotencyKey: params.idempotencyKey,
        events: {
          create: {
            sequence: 1,
            type: "progress",
            message: "Operação enfileirada, aguardando worker…",
            progress: 0,
          },
        },
      },
    });

    await this.queue.operationsQueue.add(
      "execute",
      { jobId: job.id },
      { removeOnComplete: 100, removeOnFail: 100 },
    );

    return job;
  }

  async list(organizationId: string) {
    return this.prisma.client.job.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  async get(organizationId: string, jobId: string) {
    const job = await this.prisma.client.job.findFirst({
      where: { id: jobId, organizationId },
      include: {
        events: { orderBy: { sequence: "asc" } },
        requestedBy: { select: { id: true, email: true } },
        server: { select: { id: true, name: true, host: true } },
      },
    });
    if (!job) {
      throw new NotFoundException({ error: { code: "JOB_NOT_FOUND", message: "Job não encontrado." } });
    }
    return job;
  }
}
