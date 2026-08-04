import { Module } from "@nestjs/common";
import { ApiKeysModule } from "./api-keys/api-keys.module";
import { AssistantModule } from "./assistant/assistant.module";
import { AuthModule } from "./auth/auth.module";
import { ReportsModule } from "./reports/reports.module";
import { AuditModule } from "./audit/audit.module";
import { TerminalModule } from "./terminal/terminal.module";
import { HealthModule } from "./health/health.module";
import { JobsModule } from "./jobs/jobs.module";
import { OrganizationsModule } from "./organizations/organizations.module";
import { PrismaModule } from "./prisma/prisma.module";
import { QueueModule } from "./queue/queue.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { SitesModule } from "./sites/sites.module";
import { ServersModule } from "./servers/servers.module";

@Module({
  imports: [
    PrismaModule,
    QueueModule,
    AuditModule,
    AuthModule,
    ApiKeysModule,
    AssistantModule,
    ReportsModule,
    OrganizationsModule,
    ServersModule,
    SitesModule,
    DashboardModule,
    JobsModule,
    HealthModule,
    TerminalModule,
  ],
})
export class AppModule {}
