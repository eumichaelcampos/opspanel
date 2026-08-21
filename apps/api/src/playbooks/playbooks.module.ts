import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../audit/audit.module";
import { JobsModule } from "../jobs/jobs.module";
import { PlaybooksController } from "./playbooks.controller";
import { PlaybooksService } from "./playbooks.service";

@Module({
  imports: [AuthModule, JobsModule, AuditModule],
  controllers: [PlaybooksController],
  providers: [PlaybooksService],
  exports: [PlaybooksService],
})
export class PlaybooksModule {}
