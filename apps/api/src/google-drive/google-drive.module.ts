import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { GoogleDriveController } from "./google-drive.controller";
import { GoogleDriveService } from "./google-drive.service";
import { GoogleOAuthBrokerController } from "./google-oauth-broker.controller";
import { GoogleOAuthBrokerService } from "./google-oauth-broker.service";

@Module({
  imports: [AuthModule],
  controllers: [GoogleDriveController, GoogleOAuthBrokerController],
  providers: [GoogleDriveService, GoogleOAuthBrokerService],
  exports: [GoogleDriveService, GoogleOAuthBrokerService],
})
export class GoogleDriveModule {}
