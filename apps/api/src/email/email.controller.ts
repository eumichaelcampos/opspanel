import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from "@nestjs/common";
import { AuthGuard, CurrentUser } from "../auth/auth.guard";
import type { SessionUser } from "../auth/auth.service";
import { EmailService } from "./email.service";

@Controller()
export class EmailController {
  constructor(private readonly email: EmailService) {}

  @Get("email")
  @UseGuards(AuthGuard)
  orgHub(@CurrentUser() user: SessionUser) {
    return this.email.getOrgHub(user);
  }

  @Get("settings/email-provider")
  @UseGuards(AuthGuard)
  providerSettings(@CurrentUser() user: SessionUser) {
    return this.email.getProviderSettings(user);
  }

  @Get("sites/:siteId/email")
  @UseGuards(AuthGuard)
  siteOverview(@CurrentUser() user: SessionUser, @Param("siteId") siteId: string) {
    return this.email.getSiteEmail(user, siteId);
  }

  @Get("sites/:siteId/email/health")
  @UseGuards(AuthGuard)
  siteHealth(
    @CurrentUser() user: SessionUser,
    @Param("siteId") siteId: string,
    @Query("refresh") refresh?: string,
  ) {
    return this.email.getSiteHealth(user, siteId, refresh === "1" || refresh === "true");
  }

  @Post("sites/:siteId/email/domains")
  @UseGuards(AuthGuard)
  activateDomain(@CurrentUser() user: SessionUser, @Param("siteId") siteId: string) {
    return this.email.activateSiteEmail(user, siteId);
  }

  @Post("sites/:siteId/email/domains/sync-dns")
  @UseGuards(AuthGuard)
  syncDns(@CurrentUser() user: SessionUser, @Param("siteId") siteId: string) {
    return this.email.syncSiteDns(user, siteId);
  }

  @Post("sites/:siteId/email/mailboxes")
  @UseGuards(AuthGuard)
  createMailbox(@CurrentUser() user: SessionUser, @Param("siteId") siteId: string, @Body() body: unknown) {
    return this.email.createMailbox(user, siteId, body);
  }

  @Delete("sites/:siteId/email/mailboxes/:mailboxId")
  @UseGuards(AuthGuard)
  deleteMailbox(
    @CurrentUser() user: SessionUser,
    @Param("siteId") siteId: string,
    @Param("mailboxId") mailboxId: string,
  ) {
    return this.email.deleteMailbox(user, siteId, mailboxId);
  }

  @Get("sites/:siteId/email/smtp")
  @UseGuards(AuthGuard)
  getSmtp(@CurrentUser() user: SessionUser, @Param("siteId") siteId: string) {
    return this.email.getSiteEmail(user, siteId).then((r) => ({ smtp: r.smtp, provider: r.provider }));
  }

  @Put("sites/:siteId/email/smtp")
  @UseGuards(AuthGuard)
  upsertSmtp(@CurrentUser() user: SessionUser, @Param("siteId") siteId: string, @Body() body: unknown) {
    return this.email.upsertSmtpProfile(user, siteId, body);
  }

  @Post("sites/:siteId/email/smtp/test")
  @UseGuards(AuthGuard)
  testSmtp(@CurrentUser() user: SessionUser, @Param("siteId") siteId: string, @Body() body: unknown) {
    return this.email.testSmtp(user, siteId, body);
  }
}
