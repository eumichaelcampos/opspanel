import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { InstanceSettingsController } from "./instance-settings.controller";
import { InstanceSettingsService } from "./instance-settings.service";

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [InstanceSettingsController],
  providers: [InstanceSettingsService],
  exports: [InstanceSettingsService],
})
export class SettingsModule {}
