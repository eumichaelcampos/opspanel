import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { AuditService } from "../audit/audit.service";
import { AuthGuard, CurrentUser, SESSION_COOKIE } from "./auth.guard";
import { AuthService, SessionUser } from "./auth.service";

const loginSchema = z.object({
  email: z
    .string()
    .refine((v) => /^[^\s@]+@[^\s@]+$/.test(v), { message: "E-mail inválido" }),
  password: z.string().min(8),
});

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  @Post("login")
  async login(
    @Body() body: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      throw new UnauthorizedException({
        error: { code: "INVALID_CREDENTIALS", message: "E-mail ou senha inválidos." },
      });
    }

    const result = await this.auth.login(parsed.data.email, parsed.data.password, {
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    if (!result) {
      throw new UnauthorizedException({
        error: { code: "INVALID_CREDENTIALS", message: "E-mail ou senha inválidos." },
      });
    }

    res.setCookie(SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 7,
    });

    await this.audit.log({
      organizationId: result.user.organizationId,
      actorUserId: result.user.id,
      action: "auth.login",
      targetType: "user",
      targetId: result.user.id,
      result: "success",
      ipAddress: req.ip,
    });

    return { user: { id: result.user.id, email: result.user.email, role: result.user.role } };
  }

  @Post("logout")
  @UseGuards(AuthGuard)
  async logout(@Req() req: FastifyRequest, @Res({ passthrough: true }) res: FastifyReply) {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) await this.auth.logout(token);
    res.clearCookie(SESSION_COOKIE, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
    return { ok: true };
  }
}

const profileUpdateSchema = z.object({
  name: z.string().max(120).optional(),
  password: z.string().min(8).max(128).optional(),
  currentPassword: z.string().min(8).optional(),
});

@Controller()
export class MeController {
  constructor(private readonly auth: AuthService) {}

  @Get("me")
  @UseGuards(AuthGuard)
  async me(@CurrentUser() user: SessionUser) {
    const profile = await this.auth.getProfile(user);
    return { user: profile };
  }

  @Patch("me")
  @UseGuards(AuthGuard)
  async updateMe(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    const parsed = profileUpdateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ error: { code: "VALIDATION_ERROR", message: "Dados inválidos." } });
    }
    const result = await this.auth.updateProfile(user, parsed.data);
    if (!result) {
      throw new BadRequestException({ error: { code: "NOT_FOUND", message: "Usuário não encontrado." } });
    }
    if ("error" in result) {
      throw new BadRequestException({ error: { code: "VALIDATION_ERROR", message: result.error } });
    }
    return { user: result };
  }
}
