import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { AuthGuard, CurrentUser, SessionUser } from "../auth/auth.guard";
import { PerformanceService } from "./performance.service";

@Controller()
@UseGuards(AuthGuard)
export class PerformanceController {
  constructor(private readonly performance: PerformanceService) {}

  @Get("performance/advisor")
  advisor(@CurrentUser() user: SessionUser, @Query("ttfb") ttfb?: string) {
    return this.performance.getAdvisor(user, { ttfb: ttfb === "1" || ttfb === "true" });
  }

  @Post("performance/advisor/apply")
  apply(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    return this.performance.applyRecommendation(user, body);
  }
}
