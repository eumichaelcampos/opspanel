import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { FastifyRequest } from "fastify";
import { z } from "zod";
import { AuthGuard, CurrentUser } from "../auth/auth.guard";
import { SessionUser } from "../auth/auth.service";
import { ApiKeysService } from "./api-keys.service";

const createSchema = z.object({ name: z.string().min(2).max(80) });

@Controller("api-keys")
@UseGuards(AuthGuard)
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Get()
  list(@CurrentUser() user: SessionUser) {
    return this.apiKeys.list(user);
  }

  @Post()
  create(@CurrentUser() user: SessionUser, @Body() body: unknown, @Req() req: FastifyRequest) {
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return { error: { code: "VALIDATION_ERROR", message: "Nome inválido." } };
    }
    return this.apiKeys.create(user, parsed.data.name, req.ip);
  }

  @Delete(":keyId")
  revoke(@CurrentUser() user: SessionUser, @Param("keyId") keyId: string, @Req() req: FastifyRequest) {
    return this.apiKeys.revoke(user, keyId, req.ip);
  }
}
