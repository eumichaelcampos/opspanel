import { Controller, Delete, Get, Query, Res, UseGuards } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { AuthGuard, CurrentUser } from "../auth/auth.guard";
import type { SessionUser } from "../auth/auth.service";
import { GoogleDriveService } from "./google-drive.service";

@Controller()
export class GoogleDriveController {
  constructor(private readonly drive: GoogleDriveService) {}

  @Get("me/google-drive/oauth/callback")
  async oauthCallback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error") error: string | undefined,
    @Query("error_description") errorDescription: string | undefined,
    @Res() res: FastifyReply,
  ) {
    const result = await this.drive.completeOAuth({
      code,
      state,
      error,
      error_description: errorDescription,
    });
    return res.redirect(result.redirectTo, 302);
  }

  @Get("me/google-drive/oauth/complete")
  async oauthComplete(
    @Query("ticket") ticket: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error") error: string | undefined,
    @Res() res: FastifyReply,
  ) {
    const result = await this.drive.completeOAuthBroker({ ticket, state, error });
    return res.redirect(result.redirectTo, 302);
  }

  @Get("me/google-drive")
  @UseGuards(AuthGuard)
  status(@CurrentUser() user: SessionUser) {
    return this.drive.getStatus(user.id);
  }

  @Get("me/google-drive/oauth/start")
  @UseGuards(AuthGuard)
  async oauthStart(@CurrentUser() user: SessionUser, @Res() res: FastifyReply) {
    const url = await this.drive.beginOAuth(user.id);
    return res.redirect(url, 302);
  }

  @Delete("me/google-drive")
  @UseGuards(AuthGuard)
  disconnect(@CurrentUser() user: SessionUser) {
    return this.drive.disconnect(user.id);
  }
}
