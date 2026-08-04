import { Global, Module } from "@nestjs/common";
import { LicenseController } from "./license.controller";
import { LicenseService } from "./license.service";
import { QuotasService } from "./quotas.service";

@Global()
@Module({
  controllers: [LicenseController],
  providers: [LicenseService, QuotasService],
  exports: [LicenseService, QuotasService],
})
export class LicenseModule {}
