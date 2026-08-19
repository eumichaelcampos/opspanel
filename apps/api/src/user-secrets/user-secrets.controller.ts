import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Post,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { AuthGuard, CurrentUser } from "../auth/auth.guard";
import type { SessionUser } from "../auth/auth.service";
import { UserSecretsService } from "./user-secrets.service";

const upsertSchema = z.object({
  apiKey: z.string().min(20).max(256),
  label: z.string().max(80).optional(),
});

@Controller("me/openai")
@UseGuards(AuthGuard)
export class UserSecretsController {
  constructor(private readonly secrets: UserSecretsService) {}

  @Get()
  status(@CurrentUser() user: SessionUser) {
    return this.secrets.getOpenAiStatus(user.id);
  }

  @Post()
  connect(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    const parsed = upsertSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: { code: "VALIDATION_ERROR", message: "Informe uma API key válida da OpenAI." },
      });
    }
    return this.secrets.upsertOpenAiApiKey(user.id, parsed.data.apiKey, parsed.data.label);
  }

  @Post("test")
  async test(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    const parsed = upsertSchema.safeParse(body);
    const key =
      parsed.success && parsed.data.apiKey
        ? parsed.data.apiKey.trim()
        : await this.secrets.getOpenAiApiKey(user.id);
    if (!key) {
      return { ok: false, message: "Nenhuma chave para testar." };
    }
    return this.secrets.testOpenAiKey(key);
  }

  @Delete()
  disconnect(@CurrentUser() user: SessionUser) {
    return this.secrets.deleteOpenAiApiKey(user.id);
  }
}
