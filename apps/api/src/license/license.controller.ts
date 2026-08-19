import { Body, Controller, Get, Post, UseGuards, ForbiddenException, BadRequestException } from "@nestjs/common";
import { OrgRole } from "@opspanel/database";
import { AuthGuard, CurrentUser } from "../auth/auth.guard";
import { SessionUser } from "../auth/auth.service";
import { LicenseService } from "./license.service";
import { QuotasService } from "./quotas.service";

@Controller("license")
@UseGuards(AuthGuard)
export class LicenseController {
  constructor(
    private readonly license: LicenseService,
    private readonly quotas: QuotasService,
  ) {}

  @Get()
  async status() {
    const [summary, usage, emailUsage] = await Promise.all([
      this.license.getSummary(),
      this.quotas.getUsageSnapshot(),
      this.quotas.getEmailUsageSnapshot(),
    ]);
    return { license: summary, usage, emailUsage };
  }

  @Post("sync")
  async sync(@CurrentUser() user: SessionUser) {
    if (user.role !== OrgRole.owner && user.role !== OrgRole.admin) {
      throw new ForbiddenException({ error: { code: "FORBIDDEN", message: "Permissão insuficiente." } });
    }
    try {
      const license = await this.license.syncWithCloud("heartbeat");
      return { ok: true, license: license ?? (await this.license.getSummary()) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Falha ao sincronizar licença.";
      throw new BadRequestException({ error: { code: "LICENSE_SYNC_FAILED", message: msg } });
    }
  }

  @Post("activate")
  async activate(
    @CurrentUser() user: SessionUser,
    @Body() body: { licenseKey?: string; entitlementsJwt?: string },
  ) {
    if (user.role !== OrgRole.owner && user.role !== OrgRole.admin) {
      throw new ForbiddenException({ error: { code: "FORBIDDEN", message: "Permissão insuficiente." } });
    }
    const key = body.licenseKey?.trim();
    if (!key) {
      throw new BadRequestException({ error: { code: "VALIDATION_ERROR", message: "licenseKey obrigatório." } });
    }
    try {
      const summary = await this.license.activateLicenseKey(key, body.entitlementsJwt);
      return { ok: true, license: summary };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Falha ao ativar licença.";
      throw new BadRequestException({ error: { code: "LICENSE_ACTIVATION_FAILED", message: msg } });
    }
  }

  @Get("billing/plans")
  async billingPlans() {
    try {
      return await this.license.getBillingPlans();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Billing indisponível.";
      throw new BadRequestException({ error: { code: "BILLING_UNAVAILABLE", message: msg } });
    }
  }

  @Post("billing/checkout")
  async billingCheckout(
    @CurrentUser() user: SessionUser,
    @Body() body: { plan?: "pro" | "business" },
  ) {
    if (user.role !== OrgRole.owner && user.role !== OrgRole.admin) {
      throw new ForbiddenException({ error: { code: "FORBIDDEN", message: "Permissão insuficiente." } });
    }
    if (body.plan !== "pro" && body.plan !== "business") {
      throw new BadRequestException({ error: { code: "VALIDATION_ERROR", message: "Plano inválido." } });
    }
    try {
      const session = await this.license.createBillingCheckout(body.plan);
      return { ok: true, ...session };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Falha ao iniciar checkout.";
      throw new BadRequestException({ error: { code: "CHECKOUT_FAILED", message: msg } });
    }
  }

  @Post("billing/portal")
  async billingPortal(@CurrentUser() user: SessionUser) {
    if (user.role !== OrgRole.owner && user.role !== OrgRole.admin) {
      throw new ForbiddenException({ error: { code: "FORBIDDEN", message: "Permissão insuficiente." } });
    }
    try {
      const session = await this.license.createBillingPortal();
      return { ok: true, ...session };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Falha ao abrir portal.";
      throw new BadRequestException({ error: { code: "PORTAL_FAILED", message: msg } });
    }
  }
}
