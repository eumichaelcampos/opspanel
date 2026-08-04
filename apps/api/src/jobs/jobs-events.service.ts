import { Injectable, NotFoundException } from "@nestjs/common";
import { JobStatus } from "@opspanel/database";
import { FastifyReply, FastifyRequest } from "fastify";
import { PrismaService } from "../prisma/prisma.service";

const TERMINAL: JobStatus[] = [
  JobStatus.succeeded,
  JobStatus.failed,
  JobStatus.cancelled,
  JobStatus.timed_out,
];

@Injectable()
export class JobsEventsService {
  constructor(private readonly prisma: PrismaService) {}

  async stream(organizationId: string, jobId: string, req: FastifyRequest, reply: FastifyReply) {
    const job = await this.prisma.client.job.findFirst({ where: { id: jobId, organizationId } });
    if (!job) {
      throw new NotFoundException({ error: { code: "JOB_NOT_FOUND", message: "Job não encontrado." } });
    }

    let lastSequence = 0;
    const headerLast = req.headers["last-event-id"];
    if (headerLast) {
      const parsed = Number.parseInt(String(headerLast), 10);
      if (!Number.isNaN(parsed)) lastSequence = parsed;
    }

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const sendEvents = async () => {
      const events = await this.prisma.client.jobEvent.findMany({
        where: { jobId, sequence: { gt: lastSequence } },
        orderBy: { sequence: "asc" },
      });
      for (const event of events) {
        reply.raw.write(`id: ${event.sequence}\n`);
        reply.raw.write("event: job.event\n");
        reply.raw.write(
          `data: ${JSON.stringify({
            sequence: event.sequence,
            type: event.type,
            message: event.message,
            progress: event.progress,
          })}\n\n`,
        );
        lastSequence = event.sequence;
      }

      const current = await this.prisma.client.job.findUnique({ where: { id: jobId } });
      if (current && TERMINAL.includes(current.status)) {
        reply.raw.write("event: job.done\n");
        reply.raw.write(
          `data: ${JSON.stringify({
            status: current.status,
            progress: current.progress,
            errorMessage: current.errorMessage,
          })}\n\n`,
        );
        return true;
      }
      return false;
    };

    const doneInitially = await sendEvents();
    if (doneInitially) {
      reply.raw.end();
      return;
    }

    const timer = setInterval(() => {
      void sendEvents().then((done) => {
        if (done) {
          clearInterval(timer);
          reply.raw.end();
        }
      });
    }, 1000);

    req.raw.on("close", () => {
      clearInterval(timer);
    });
  }
}
