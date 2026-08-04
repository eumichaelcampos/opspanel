import { Module } from "@nestjs/common";
import { LicenseModule } from "../license/license.module";
import { SetupController } from "./setup.controller";
import { SetupService } from "./setup.service";

@Module({
  imports: [LicenseModule],
  controllers: [SetupController],
  providers: [SetupService],
})
export class SetupModule {}
