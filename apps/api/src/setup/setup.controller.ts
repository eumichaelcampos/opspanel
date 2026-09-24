import { BadRequestException, Body, Controller, Get, Post } from "@nestjs/common";
import { SetupService } from "./setup.service";

@Controller("setup")
export class SetupController {
  constructor(private readonly setup: SetupService) {}

  @Get("status")
  async status() {
    const setup = await this.setup.getStatus();
    return { setup };
  }

  @Post("register-license")
  async registerLicense(@Body() body: { email?: string; licenseServerUrl?: string }) {
    const email = body.email?.trim();
    if (!email) {
      throw new BadRequestException({ error: { code: "VALIDATION_ERROR", message: "email obrigatório." } });
    }
    const result = await this.setup.registerFreeLicense(email, body.licenseServerUrl);
    return { ok: true, ...result };
  }

  /** Recupera setup pela metade (user + licença ok, completed=false). */
  @Post("recover")
  async recover(@Body() body: { adminEmail?: string; adminPassword?: string }) {
    if (!body.adminEmail || !body.adminPassword) {
      throw new BadRequestException({
        error: { code: "VALIDATION_ERROR", message: "adminEmail e adminPassword são obrigatórios." },
      });
    }
    return this.setup.recoverIncompleteSetup({
      adminEmail: body.adminEmail,
      adminPassword: body.adminPassword,
    });
  }

  @Post("complete")
  async complete(
    @Body()
    body: {
      organizationName?: string;
      adminEmail?: string;
      adminPassword?: string;
      adminName?: string;
      licenseKey?: string;
      licenseServerUrl?: string;
      panelDomain?: string;
      panelUseHttps?: boolean;
    },
  ) {
    if (!body.organizationName || !body.adminEmail || !body.adminPassword || !body.licenseKey) {
      throw new BadRequestException({ error: { code: "VALIDATION_ERROR", message: "Campos obrigatórios ausentes." } });
    }
    try {
      return await this.setup.completeSetup({
        organizationName: body.organizationName,
        adminEmail: body.adminEmail,
        adminPassword: body.adminPassword,
        adminName: body.adminName,
        licenseKey: body.licenseKey,
        licenseServerUrl: body.licenseServerUrl,
        panelDomain: body.panelDomain,
        panelUseHttps: body.panelUseHttps,
      });
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadRequestException({
        error: { code: "SETUP_FAILED", message: msg || "Falha ao concluir o setup." },
      });
    }
  }
}
