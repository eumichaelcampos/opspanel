import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { FastifyRequest } from "fastify";
import { AuthGuard, CurrentUser, SessionUser } from "../auth/auth.guard";
import { PlaybooksService } from "./playbooks.service";

@Controller()
@UseGuards(AuthGuard)
export class PlaybooksController {
  constructor(private readonly playbooks: PlaybooksService) {}

  @Get("playbooks")
  list() {
    return this.playbooks.list();
  }

  @Post("playbooks/:id/run")
  run(
    @CurrentUser() user: SessionUser,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ) {
    return this.playbooks.run(user, id, body, req.ip);
  }
}
