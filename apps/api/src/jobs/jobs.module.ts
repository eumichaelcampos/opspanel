import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { JobsController } from "./jobs.controller";
import { JobsEventsController } from "./jobs-events.controller";
import { JobsEventsService } from "./jobs-events.service";
import { JobsService } from "./jobs.service";

@Module({
  imports: [AuthModule],
  controllers: [JobsController, JobsEventsController],
  providers: [JobsService, JobsEventsService],
  exports: [JobsService],
})
export class JobsModule {}
