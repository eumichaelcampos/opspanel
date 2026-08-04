import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { OrganizationsController } from "./organizations.controller";

@Module({
  imports: [AuthModule],
  controllers: [OrganizationsController],
})
export class OrganizationsModule {}
