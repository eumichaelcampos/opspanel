import { Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { AuthGuard, CurrentUser, SessionUser } from "../auth/auth.guard";
import { DnsService } from "./dns.service";

@Controller()
@UseGuards(AuthGuard)
export class DnsController {
  constructor(private readonly dns: DnsService) {}

  @Get("dns")
  hub(@CurrentUser() user: SessionUser) {
    return this.dns.getHub(user);
  }

  @Get("dns/doctor")
  doctorQuery(
    @CurrentUser() user: SessionUser,
    @Query("domain") domain?: string,
    @Query("serverId") serverId?: string,
    @Query("siteId") siteId?: string,
  ) {
    return this.dns.doctorQuery(user, { domain, serverId, siteId });
  }

  @Get("sites/:siteId/dns/doctor")
  doctorGet(@CurrentUser() user: SessionUser, @Param("siteId") siteId: string) {
    return this.dns.doctorForSite(user, siteId);
  }

  @Post("sites/:siteId/dns/doctor")
  doctorPost(@CurrentUser() user: SessionUser, @Param("siteId") siteId: string) {
    return this.dns.doctorForSite(user, siteId);
  }
}
