import { Module, forwardRef } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { ApiKeyGuard } from "./api-key.guard";
import { AuthController, MeController } from "./auth.controller";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";

@Module({
  imports: [forwardRef(() => AuditModule)],
  controllers: [AuthController, MeController],
  providers: [AuthService, AuthGuard, ApiKeyGuard],
  exports: [AuthService, AuthGuard, ApiKeyGuard],
})
export class AuthModule {}
