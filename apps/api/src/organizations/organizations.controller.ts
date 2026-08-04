import { Controller, Get, UseGuards } from "@nestjs/common";
import { AuthGuard, CurrentUser, SessionUser } from "../auth/auth.guard";
import { PrismaService } from "../prisma/prisma.service";

@Controller("organizations")
@UseGuards(AuthGuard)
export class OrganizationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() user: SessionUser) {
    const org = await this.prisma.client.organization.findUnique({
      where: { id: user.organizationId },
    });
    return { organizations: org ? [org] : [] };
  }
}
