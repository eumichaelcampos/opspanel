import { Controller, Get, UseGuards } from "@nestjs/common";
import { AuthGuard, CurrentUser } from "../auth/auth.guard";
import { SessionUser } from "../auth/auth.service";
import { ReportsService } from "./reports.service";

@Controller("reports")
@UseGuards(AuthGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get("summary")
  summary(@CurrentUser() user: SessionUser) {
    return this.reports.getSummary(user);
  }
}
