import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { AuthGuard, CurrentUser, SessionUser } from "../auth/auth.guard";
import { AlertsService } from "./alerts.service";

@Controller()
@UseGuards(AuthGuard)
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get("alerts")
  hub(@CurrentUser() user: SessionUser) {
    return this.alerts.getHub(user);
  }

  @Post("alerts/channels")
  create(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    return this.alerts.createChannel(user, body);
  }

  @Patch("alerts/channels/:id")
  update(@CurrentUser() user: SessionUser, @Param("id") id: string, @Body() body: unknown) {
    return this.alerts.updateChannel(user, id, body);
  }

  @Delete("alerts/channels/:id")
  remove(@CurrentUser() user: SessionUser, @Param("id") id: string) {
    return this.alerts.deleteChannel(user, id);
  }

  @Post("alerts/channels/:id/test")
  test(@CurrentUser() user: SessionUser, @Param("id") id: string) {
    return this.alerts.testChannel(user, id);
  }
}
