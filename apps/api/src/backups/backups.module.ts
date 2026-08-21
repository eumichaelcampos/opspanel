import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SitesModule } from "../sites/sites.module";
import { BackupsController } from "./backups.controller";
import { BackupsService } from "./backups.service";

@Module({
  imports: [AuthModule, SitesModule],
  controllers: [BackupsController],
  providers: [BackupsService],
  exports: [BackupsService],
})
export class BackupsModule {}
