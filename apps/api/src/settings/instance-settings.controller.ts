import { BadRequestException, Body, Controller, Get, Patch, Post, UseGuards } from "@nestjs/common";
import { AuthGuard, CurrentUser } from "../auth/auth.guard";
import type { SessionUser } from "../auth/auth.service";
import { InstanceSettingsService } from "./instance-settings.service";

@Controller("settings/instance")
@UseGuards(AuthGuard)
export class InstanceSettingsController {
  constructor(private readonly instance: InstanceSettingsService) {}

  @Get()
  get(@CurrentUser() user: SessionUser) {
    return this.instance.get(user);
  }

  @Patch()
  update(
    @CurrentUser() user: SessionUser,
    @Body()
    body: {
      organizationName?: string;
      panelDomain?: string | null;
      useHttps?: boolean;
      googleDriveClientId?: string | null;
      googleDriveClientSecret?: string | null;
    },
  ) {
    return this.instance.update(user, body ?? {});
  }

  @Post("panel-domain")
  applyDomain(
    @CurrentUser() user: SessionUser,
    @Body() body: { domain?: string | null; useHttps?: boolean },
  ) {
    if (body?.domain === undefined) {
      throw new BadRequestException({
        error: { code: "VALIDATION_ERROR", message: "Informe domain (string) ou null para limpar." },
      });
    }
    return this.instance.applyPanelDomain(user, body.domain, body.useHttps !== false);
  }
}
