import { Controller, Get, UseGuards } from "@nestjs/common";
import { AuthGuard, CurrentUser, SessionUser } from "../auth/auth.guard";
import { StagingService } from "./staging.service";

@Controller()
@UseGuards(AuthGuard)
export class StagingController {
  constructor(private readonly staging: StagingService) {}

  @Get("staging")
  hub(@CurrentUser() user: SessionUser) {
    return this.staging.getHub(user);
  }
}
