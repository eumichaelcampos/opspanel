import { Controller, Get, UseGuards } from "@nestjs/common";
import { AuthGuard, CurrentUser } from "../auth/auth.guard";
import { SessionUser } from "../auth/auth.service";
import { PrismaService } from "../prisma/prisma.service";

@Controller("audit-logs")
@UseGuards(AuthGuard)
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() user: SessionUser): Promise<{ logs: unknown[] }> {
    const logs = await this.prisma.client.auditLog.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { actor: { select: { email: true } } },
    });
    return { logs };
  }
}
