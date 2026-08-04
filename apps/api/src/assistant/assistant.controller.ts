import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import { FastifyRequest } from "fastify";
import { z } from "zod";
import { AuthGuard, CurrentUser } from "../auth/auth.guard";
import { SessionUser } from "../auth/auth.service";
import { AssistantService } from "./assistant.service";

const chatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.string().min(1).max(8000),
      }),
    )
    .min(1)
    .max(40),
});

@Controller("assistant")
@UseGuards(AuthGuard)
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Post("chat")
  chat(@CurrentUser() user: SessionUser, @Body() body: unknown, @Req() req: FastifyRequest) {
    const parsed = chatSchema.safeParse(body);
    if (!parsed.success) {
      return { error: { code: "VALIDATION_ERROR", message: "Mensagens inválidas." } };
    }
    return this.assistant.chat(user, parsed.data.messages, req.ip);
  }
}
