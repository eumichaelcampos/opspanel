import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { ServersModule } from "../servers/servers.module";
import { TerminalService } from "./terminal.service";

@Module({
  imports: [AuthModule, AuditModule, ServersModule],
  providers: [TerminalService],
  exports: [TerminalService],
})
export class TerminalModule {}
