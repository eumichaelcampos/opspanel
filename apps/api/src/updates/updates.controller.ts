import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  UseGuards,
} from "@nestjs/common";
import { OrgRole } from "@opspanel/database";
import { AuthGuard, CurrentUser } from "../auth/auth.guard";
import { SessionUser } from "../auth/auth.service";
import { UpdatesService } from "./updates.service";

@Controller("updates")
@UseGuards(AuthGuard)
export class UpdatesController {
  constructor(private readonly updates: UpdatesService) {}

  private canApply(role: OrgRole): boolean {
    return role === OrgRole.owner || role === OrgRole.admin;
  }

  @Get("status")
  async status(@CurrentUser() user: SessionUser) {
    const update = await this.updates.getStatusForUser(user.id, this.canApply(user.role));
    return { update };
  }

  @Post("check")
  async check(@CurrentUser() user: SessionUser) {
    if (!this.canApply(user.role)) {
      throw new ForbiddenException({ error: { code: "FORBIDDEN", message: "Permissão insuficiente." } });
    }
    const update = await this.updates.checkForUpdates();
    return { ok: true, update };
  }

  @Post("dismiss")
  async dismiss(@CurrentUser() user: SessionUser, @Body() body: { version?: string }) {
    const version = body.version?.trim();
    if (!version) {
      throw new BadRequestException({ error: { code: "VALIDATION_ERROR", message: "version obrigatório." } });
    }
    await this.updates.dismiss(user.id, version);
    const update = await this.updates.getStatusForUser(user.id, this.canApply(user.role));
    return { ok: true, update };
  }

  @Post("apply")
  async apply(@CurrentUser() user: SessionUser) {
    if (!this.canApply(user.role)) {
      throw new ForbiddenException({ error: { code: "FORBIDDEN", message: "Permissão insuficiente." } });
    }
    try {
      const result = await this.updates.applyUpdate();
      const update = await this.updates.getStatusForUser(user.id, true);
      return { ...result, update };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Falha ao aplicar atualização.";
      throw new BadRequestException({ error: { code: "UPDATE_FAILED", message: msg } });
    }
  }
}
