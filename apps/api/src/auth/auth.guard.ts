import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { FastifyRequest } from "fastify";
import { ApiKeyGuard } from "./api-key.guard";
import { AuthService, SessionUser } from "./auth.service";

export type { SessionUser };

export const SESSION_COOKIE = "opspanel_session";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly apiKeyGuard: ApiKeyGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const user = await this.resolveUser(request);
    if (!user) {
      throw new UnauthorizedException({
        error: { code: "UNAUTHORIZED", message: "Sessão inválida ou expirada." },
      });
    }
    (request as FastifyRequest & { user: SessionUser }).user = user;
    return true;
  }

  async resolveUser(request: FastifyRequest): Promise<SessionUser | null> {
    const token = request.cookies?.[SESSION_COOKIE];
    if (token) {
      const sessionUser = await this.auth.validateSessionToken(token);
      if (sessionUser) return sessionUser;
    }
    return this.apiKeyGuard.resolveUser(request);
  }
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SessionUser => {
    const request = ctx.switchToHttp().getRequest<FastifyRequest & { user: SessionUser }>();
    return request.user;
  },
);

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
