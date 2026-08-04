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
    },
  ) {
    if (!body.organizationName || !body.adminEmail || !body.adminPassword || !body.licenseKey) {
      throw new BadRequestException({ error: { code: "VALIDATION_ERROR", message: "Campos obrigatórios ausentes." } });
    }
    return this.setup.completeSetup({
      organizationName: body.organizationName,
      adminEmail: body.adminEmail,
      adminPassword: body.adminPassword,
      adminName: body.adminName,
      licenseKey: body.licenseKey,
      licenseServerUrl: body.licenseServerUrl,
    });
  }
}
