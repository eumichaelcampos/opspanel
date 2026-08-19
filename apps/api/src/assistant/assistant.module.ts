import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CodexModule } from "../codex/codex.module";
import { DashboardModule } from "../dashboard/dashboard.module";
import { LicenseModule } from "../license/license.module";
import { SitesModule } from "../sites/sites.module";
import { UserSecretsModule } from "../user-secrets/user-secrets.module";
import { AssistantController } from "./assistant.controller";
import { AssistantService } from "./assistant.service";

@Module({
  imports: [AuthModule, CodexModule, DashboardModule, SitesModule, UserSecretsModule, LicenseModule],  controllers: [AssistantController],
  providers: [AssistantService],
  exports: [AssistantService],
})
export class AssistantModule {}
