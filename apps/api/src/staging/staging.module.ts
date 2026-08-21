import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { StagingController } from "./staging.controller";
import { StagingService } from "./staging.service";

@Module({
  imports: [AuthModule],
  controllers: [StagingController],
  providers: [StagingService],
  exports: [StagingService],
})
export class StagingModule {}
