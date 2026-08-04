import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DashboardModule } from "../dashboard/dashboard.module";
import { SitesModule } from "../sites/sites.module";
import { AssistantController } from "./assistant.controller";
import { AssistantService } from "./assistant.service";

@Module({
  imports: [AuthModule, DashboardModule, SitesModule],
  controllers: [AssistantController],
  providers: [AssistantService],
})
export class AssistantModule {}
