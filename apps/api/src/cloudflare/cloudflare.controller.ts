import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { AuthGuard, CurrentUser } from "../auth/auth.guard";
import type { SessionUser } from "../auth/auth.service";
import { CloudflareService } from "./cloudflare.service";

@Controller()
export class CloudflareController {
  constructor(private readonly cloudflare: CloudflareService) {}

  /** Callback OAuth: sem AuthGuard (identidade vem do state assinado). */
  @Get("me/cloudflare/oauth/callback")
  async oauthCallback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error") error: string | undefined,
    @Query("error_description") errorDescription: string | undefined,
    @Res() res: FastifyReply,
  ) {
    const result = await this.cloudflare.completeOAuth({
      code,
      state,
      error,
      error_description: errorDescription,
    });
    return res.redirect(result.redirectTo, 302);
  }

  @Get("me/cloudflare")
  @UseGuards(AuthGuard)
  meStatus(@CurrentUser() user: SessionUser) {
    return this.cloudflare.getCredentialsStatus(user.id);
  }

  @Get("me/cloudflare/oauth/start")
  @UseGuards(AuthGuard)
  oauthStart(@CurrentUser() user: SessionUser, @Res() res: FastifyReply) {
    const url = this.cloudflare.beginOAuth(user.id);
    return res.redirect(url, 302);
  }

  @Post("me/cloudflare")
  @UseGuards(AuthGuard)
  meConnect(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    return this.cloudflare.connect(user.id, body);
  }

  @Delete("me/cloudflare")
  @UseGuards(AuthGuard)
  meDisconnect(@CurrentUser() user: SessionUser) {
    return this.cloudflare.disconnect(user.id);
  }

  @Get("sites/:siteId/cloudflare")
  @UseGuards(AuthGuard)
  overview(@CurrentUser() user: SessionUser, @Param("siteId") siteId: string) {
    return this.cloudflare.getOverview(user, siteId);
  }

  @Get("sites/:siteId/cloudflare/dns")
  @UseGuards(AuthGuard)
  listDns(@CurrentUser() user: SessionUser, @Param("siteId") siteId: string) {
    return this.cloudflare.listDns(user, siteId);
  }

  @Post("sites/:siteId/cloudflare/dns")
  @UseGuards(AuthGuard)
  createDns(
    @CurrentUser() user: SessionUser,
    @Param("siteId") siteId: string,
    @Body() body: unknown,
  ) {
    return this.cloudflare.createDns(user, siteId, body);
  }

  @Patch("sites/:siteId/cloudflare/dns/:recordId")
  @UseGuards(AuthGuard)
  updateDns(
    @CurrentUser() user: SessionUser,
    @Param("siteId") siteId: string,
    @Param("recordId") recordId: string,
    @Body() body: unknown,
  ) {
    return this.cloudflare.updateDns(user, siteId, recordId, body);
  }

  @Delete("sites/:siteId/cloudflare/dns/:recordId")
  @UseGuards(AuthGuard)
  deleteDns(
    @CurrentUser() user: SessionUser,
    @Param("siteId") siteId: string,
    @Param("recordId") recordId: string,
  ) {
    return this.cloudflare.deleteDns(user, siteId, recordId);
  }

  @Post("sites/:siteId/cloudflare/dns/point-server")
  @UseGuards(AuthGuard)
  pointServer(
    @CurrentUser() user: SessionUser,
    @Param("siteId") siteId: string,
    @Body() body: unknown,
  ) {
    return this.cloudflare.pointToServer(user, siteId, body);
  }

  @Post("sites/:siteId/cloudflare/optimize")
  @UseGuards(AuthGuard)
  optimize(@CurrentUser() user: SessionUser, @Param("siteId") siteId: string) {
    return this.cloudflare.applyOptimizations(user, siteId);
  }

  @Get("sites/:siteId/cloudflare/page-rules")
  @UseGuards(AuthGuard)
  pageRules(@CurrentUser() user: SessionUser, @Param("siteId") siteId: string) {
    return this.cloudflare.listRules(user, siteId);
  }

  @Post("sites/:siteId/cloudflare/page-rules/wordpress")
  @UseGuards(AuthGuard)
  wordpressRules(@CurrentUser() user: SessionUser, @Param("siteId") siteId: string) {
    return this.cloudflare.applyWordpressPageRules(user, siteId);
  }

  @Post("sites/:siteId/cloudflare/page-rules")
  @UseGuards(AuthGuard)
  createRule(
    @CurrentUser() user: SessionUser,
    @Param("siteId") siteId: string,
    @Body() body: unknown,
  ) {
    return this.cloudflare.createRule(user, siteId, body);
  }

  @Patch("sites/:siteId/cloudflare/page-rules/:ruleId")
  @UseGuards(AuthGuard)
  updateRule(
    @CurrentUser() user: SessionUser,
    @Param("siteId") siteId: string,
    @Param("ruleId") ruleId: string,
    @Body() body: unknown,
  ) {
    return this.cloudflare.updateRule(user, siteId, ruleId, body);
  }

  @Delete("sites/:siteId/cloudflare/page-rules/:ruleId")
  @UseGuards(AuthGuard)
  deleteRule(
    @CurrentUser() user: SessionUser,
    @Param("siteId") siteId: string,
    @Param("ruleId") ruleId: string,
  ) {
    return this.cloudflare.deleteRule(user, siteId, ruleId);
  }
}
