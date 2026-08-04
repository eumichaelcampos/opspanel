import { Controller, Get, Param, Req, Res, UseGuards } from "@nestjs/common";
import { FastifyReply, FastifyRequest } from "fastify";
import { AuthGuard, CurrentUser } from "../auth/auth.guard";
import { SessionUser } from "../auth/auth.service";
import { JobsEventsService } from "./jobs-events.service";

@Controller("jobs")
@UseGuards(AuthGuard)
export class JobsEventsController {
  constructor(private readonly events: JobsEventsService) {}

  @Get(":jobId/events")
  async stream(
    @CurrentUser() user: SessionUser,
    @Param("jobId") jobId: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    await this.events.stream(user.organizationId, jobId, req, reply);
  }
}
