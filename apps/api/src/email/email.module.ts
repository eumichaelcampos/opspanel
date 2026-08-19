import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CloudflareModule } from "../cloudflare/cloudflare.module";
import { JobsModule } from "../jobs/jobs.module";
import { EmailController } from "./email.controller";
import { EmailDnsService } from "./email-dns.service";
import { EmailService } from "./email.service";

@Module({
  imports: [AuthModule, CloudflareModule, JobsModule],
  controllers: [EmailController],
  providers: [EmailService, EmailDnsService],
  exports: [EmailService],
})
export class EmailModule {}
