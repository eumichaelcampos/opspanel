import { Module } from "@nestjs/common";
import { CodexOAuthController } from "./codex-oauth.controller";
import { CodexOAuthService } from "./codex-oauth.service";

@Module({
  controllers: [CodexOAuthController],
  providers: [CodexOAuthService],
  exports: [CodexOAuthService],
})
export class CodexModule {}
