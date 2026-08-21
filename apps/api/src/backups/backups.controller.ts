import { Controller, Get, UseGuards } from "@nestjs/common";
import { AuthGuard, CurrentUser, SessionUser } from "../auth/auth.guard";
import { BackupsService } from "./backups.service";

@Controller()
@UseGuards(AuthGuard)
export class BackupsController {
  constructor(private readonly backups: BackupsService) {}

  @Get("backups")
  hub(@CurrentUser() user: SessionUser) {
    return this.backups.getHub(user);
  }
}
