import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CloudflareModule } from "../cloudflare/cloudflare.module";
import { DnsController } from "./dns.controller";
import { DnsService } from "./dns.service";

@Module({
  imports: [AuthModule, CloudflareModule],
  controllers: [DnsController],
  providers: [DnsService],
  exports: [DnsService],
})
export class DnsModule {}
