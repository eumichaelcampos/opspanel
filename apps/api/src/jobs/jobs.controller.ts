import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { AuthGuard, CurrentUser, SessionUser } from "../auth/auth.guard";
import { JobsService } from "./jobs.service";

@Controller("jobs")
@UseGuards(AuthGuard)
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  list(@CurrentUser() user: SessionUser): Promise<unknown[]> {
    return this.jobs.list(user.organizationId);
  }

  @Get(":jobId")
  get(@CurrentUser() user: SessionUser, @Param("jobId") jobId: string): Promise<unknown> {
    return this.jobs.get(user.organizationId, jobId);
  }
}
