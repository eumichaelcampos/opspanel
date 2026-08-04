import { Injectable } from "@nestjs/common";
import { OrgRole } from "@opspanel/database";
import { verifyPassword, hashPassword } from "@opspanel/security";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { hashSessionToken } from "./auth.guard";

export interface SessionUser {
  id: string;
  email: string;
  organizationId: string;
  role: OrgRole;
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async login(email: string, password: string, meta?: { ip?: string; userAgent?: string }) {
    const user = await this.prisma.client.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) return null;
    const valid = await verifyPassword(user.passwordHash, password);
    if (!valid) return null;

    const membership = await this.prisma.client.organizationMember.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    });
    if (!membership) return null;

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
    await this.prisma.client.session.create({
      data: {
        tokenHash: hashSessionToken(token),
        userId: user.id,
        expiresAt,
        ipAddress: meta?.ip,
        userAgent: meta?.userAgent,
      },
    });

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        organizationId: membership.organizationId,
        role: membership.role,
      } satisfies SessionUser,
    };
  }

  async validateSessionToken(token: string): Promise<SessionUser | null> {
    const session = await this.prisma.client.session.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      include: { user: true },
    });
    if (!session || session.expiresAt < new Date()) return null;

    const membership = await this.prisma.client.organizationMember.findFirst({
      where: { userId: session.userId },
      orderBy: { createdAt: "asc" },
    });
    if (!membership) return null;

    return {
      id: session.user.id,
      email: session.user.email,
      organizationId: membership.organizationId,
      role: membership.role,
    };
  }

  async logout(token: string) {
    await this.prisma.client.session.deleteMany({
      where: { tokenHash: hashSessionToken(token) },
    });
  }

  async ensurePasswordHash(password: string) {
    return hashPassword(password);
  }

  async getProfile(user: SessionUser) {
    const [dbUser, org] = await Promise.all([
      this.prisma.client.user.findUnique({ where: { id: user.id } }),
      this.prisma.client.organization.findUnique({ where: { id: user.organizationId } }),
    ]);
    return {
      id: user.id,
      email: user.email,
      name: dbUser?.name ?? null,
      role: user.role,
      organizationId: user.organizationId,
      organizationName: org?.name ?? "Organização",
    };
  }

  async updateProfile(user: SessionUser, data: { name?: string; password?: string; currentPassword?: string }) {
    const dbUser = await this.prisma.client.user.findUnique({ where: { id: user.id } });
    if (!dbUser) return null;

    const update: { name?: string | null; passwordHash?: string } = {};
    if (data.name !== undefined) {
      update.name = data.name.trim() || null;
    }
    if (data.password) {
      if (!data.currentPassword) return { error: "Senha atual obrigatória." };
      const valid = await verifyPassword(dbUser.passwordHash, data.currentPassword);
      if (!valid) return { error: "Senha atual incorreta." };
      update.passwordHash = await hashPassword(data.password);
    }

    await this.prisma.client.user.update({ where: { id: user.id }, data: update });
    return this.getProfile(user);
  }
}
