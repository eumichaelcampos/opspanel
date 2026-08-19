import { Module } from "@nestjs/common";
import { UserSecretsController } from "./user-secrets.controller";
import { UserSecretsService } from "./user-secrets.service";

@Module({
  controllers: [UserSecretsController],
  providers: [UserSecretsService],
  exports: [UserSecretsService],
})
export class UserSecretsModule {}
