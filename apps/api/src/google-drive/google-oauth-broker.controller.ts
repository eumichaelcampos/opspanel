import { Body, Controller, Get, Post, Query, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { GoogleOAuthBrokerService } from "./google-oauth-broker.service";

@Controller("oauth/google")
export class GoogleOAuthBrokerController {
  constructor(private readonly broker: GoogleOAuthBrokerService) {}

  @Get("start")
  async start(
    @Query("returnUrl") returnUrl: string | undefined,
    @Query("clientState") clientState: string | undefined,
    @Res() res: FastifyReply,
  ) {
    const url = await this.broker.start({ returnUrl, clientState });
    return res.redirect(url, 302);
  }

  @Get("callback")
  async callback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error") error: string | undefined,
    @Query("error_description") errorDescription: string | undefined,
    @Res() res: FastifyReply,
  ) {
    const result = await this.broker.callback({
      code,
      state,
      error,
      error_description: errorDescription,
    });
    return res.redirect(result.redirectTo, 302);
  }

  @Post("redeem")
  redeem(@Body() body: { ticket?: string }) {
    return this.broker.redeem(body ?? {});
  }

  @Post("refresh")
  refresh(@Body() body: { refreshToken?: string }) {
    return this.broker.refresh(body ?? {});
  }
}
