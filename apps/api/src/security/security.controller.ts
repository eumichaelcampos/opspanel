import { Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { AuthGuard, CurrentUser, SessionUser } from "../auth/auth.guard";
import { SecurityService } from "./security.service";

@Controller()
@UseGuards(AuthGuard)
export class SecurityController {
  constructor(private readonly security: SecurityService) {}

  @Get("security")
  hub(@CurrentUser() user: SessionUser) {
    return this.security.getHub(user);
  }

  @Get("servers/:serverId/security")
  serverSecurity(@CurrentUser() user: SessionUser, @Param("serverId") serverId: string) {
    return this.security.getServerSecurity(user, serverId);
  }

  @Post("servers/:serverId/security/scan")
  scan(@CurrentUser() user: SessionUser, @Param("serverId") serverId: string) {
    return this.security.scanServer(user, serverId);
  }

  @Post("servers/:serverId/security/refresh-health")
  refreshHealth(@CurrentUser() user: SessionUser, @Param("serverId") serverId: string) {
    return this.security.refreshServerHealth(user, serverId);
  }

  @Get("sites/:siteId/security")
  siteSecurity(@CurrentUser() user: SessionUser, @Param("siteId") siteId: string) {
    return this.security.getSiteSecurity(user, siteId);
  }
}
