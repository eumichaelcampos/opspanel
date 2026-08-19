import { Controller, Get, UseGuards } from "@nestjs/common";
import { AuthGuard, CurrentUser, SessionUser } from "../auth/auth.guard";
import { DashboardService } from "./dashboard.service";

@Controller("dashboard")
@UseGuards(AuthGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get("overview")
  overview(@CurrentUser() user: SessionUser): Promise<Awaited<ReturnType<DashboardService["getOverview"]>>> {
    return this.dashboard.getOverview(user);
  }
}
