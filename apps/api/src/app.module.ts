import { Module } from "@nestjs/common";
import { ApiKeysModule } from "./api-keys/api-keys.module";
import { AssistantModule } from "./assistant/assistant.module";
import { AuthModule } from "./auth/auth.module";
import { ReportsModule } from "./reports/reports.module";
import { AuditModule } from "./audit/audit.module";
import { TerminalModule } from "./terminal/terminal.module";
import { HealthModule } from "./health/health.module";
import { JobsModule } from "./jobs/jobs.module";
import { LicenseModule } from "./license/license.module";
import { SetupModule } from "./setup/setup.module";
import { UpdatesModule } from "./updates/updates.module";
import { OrganizationsModule } from "./organizations/organizations.module";
import { PrismaModule } from "./prisma/prisma.module";
import { QueueModule } from "./queue/queue.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { SitesModule } from "./sites/sites.module";
import { ServersModule } from "./servers/servers.module";
import { UserSecretsModule } from "./user-secrets/user-secrets.module";
import { ChatGptModule } from "./chatgpt/chatgpt.module";
import { CloudflareModule } from "./cloudflare/cloudflare.module";
import { SettingsModule } from "./settings/settings.module";
import { CodexModule } from "./codex/codex.module";
import { GoogleDriveModule } from "./google-drive/google-drive.module";
import { EmailModule } from "./email/email.module";
import { SecurityModule } from "./security/security.module";
import { WordpressModule } from "./wordpress/wordpress.module";
import { BackupsModule } from "./backups/backups.module";
import { DnsModule } from "./dns/dns.module";
import { StagingModule } from "./staging/staging.module";
import { PerformanceModule } from "./performance/performance.module";
import { PlaybooksModule } from "./playbooks/playbooks.module";
import { AlertsModule } from "./alerts/alerts.module";

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    QueueModule,
    AuditModule,
    LicenseModule,
    SetupModule,
    UpdatesModule,
    ApiKeysModule,
    UserSecretsModule,
    CloudflareModule,
    SettingsModule,
    ChatGptModule,
    CodexModule,
    GoogleDriveModule,
    EmailModule,
    SecurityModule,
    WordpressModule,
    BackupsModule,
    DnsModule,
    StagingModule,
    PerformanceModule,
    PlaybooksModule,
    AlertsModule,
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
