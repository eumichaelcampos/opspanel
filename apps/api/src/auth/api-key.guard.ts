import { createHash, randomBytes } from "node:crypto";
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { FastifyRequest } from "fastify";
import { PrismaService } from "../prisma/prisma.service";
import { SessionUser } from "./auth.service";

export const API_KEY_PREFIX = "opk_";

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const secret = randomBytes(24).toString("base64url");
  const key = `${API_KEY_PREFIX}${secret}`;
  return { key, prefix: key.slice(0, 12), hash: hashApiKey(key) };
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const user = await this.resolveUser(request);
    if (!user) {
      throw new UnauthorizedException({
        error: { code: "UNAUTHORIZED", message: "API key inválida ou expirada." },
      });
    }
    (request as FastifyRequest & { user: SessionUser }).user = user;
    return true;
  }

  async resolveUser(request: FastifyRequest): Promise<SessionUser | null> {
    const auth = request.headers.authorization;
    if (!auth?.startsWith("Bearer ")) return null;
    const key = auth.slice(7).trim();
    if (!key.startsWith(API_KEY_PREFIX)) return null;

    const record = await this.prisma.client.apiKey.findUnique({
      where: { keyHash: hashApiKey(key) },
      include: { createdBy: true },
    });
    if (!record || record.revokedAt) return null;

    const membership = await this.prisma.client.organizationMember.findFirst({
      where: { userId: record.createdById, organizationId: record.organizationId },
    });
    if (!membership) return null;

    void this.prisma.client.apiKey.update({
      where: { id: record.id },
      data: { lastUsedAt: new Date() },
    });

    return {
      id: record.createdBy.id,
      email: record.createdBy.email,
      organizationId: record.organizationId,
      role: membership.role,
    };
  }
}
