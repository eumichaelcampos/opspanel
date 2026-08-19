import { Body, Controller, Delete, Get, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuthGuard, CurrentUser } from "../auth/auth.guard";
import type { SessionUser } from "../auth/auth.service";
import { CodexOAuthService } from "./codex-oauth.service";

const pollSchema = z.object({
  flowId: z.string().uuid(),
});

@Controller("me/openai/codex")
@UseGuards(AuthGuard)
export class CodexOAuthController {
  constructor(private readonly codex: CodexOAuthService) {}

  @Get()
  status(@CurrentUser() user: SessionUser) {
    return this.codex.getStatus(user.id);
  }

  @Post("start")
  start(@CurrentUser() user: SessionUser) {
    return this.codex.startDeviceFlow(user.id);
  }

  @Post("poll")
  poll(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    const parsed = pollSchema.safeParse(body);
    if (!parsed.success) {
      return { pending: true };
    }
    return this.codex.pollDeviceFlow(user.id, parsed.data.flowId);
  }

  @Delete()
  disconnect(@CurrentUser() user: SessionUser) {
    return this.codex.disconnect(user.id);
  }
}
