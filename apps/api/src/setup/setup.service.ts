import { BadRequestException, Injectable } from "@nestjs/common";
import { loadEnv } from "@opspanel/config";
import { isLicenseKeyFormat } from "@opspanel/licensing";
import { hashPassword } from "@opspanel/security";
import { PrismaService } from "../prisma/prisma.service";
import { LicenseService } from "../license/license.service";
import { LicenseCloudClient } from "../license/license-cloud.client";

export type SetupStatus = {
  needsSetup: boolean;
  completed: boolean;
  hasUsers: boolean;
  licenseConfigured: boolean;
  cloudConfigured: boolean;
  licenseServerUrl: string | null;
};

@Injectable()
export class SetupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly license: LicenseService,
  ) {}

  private async ensureSetupState() {
    return this.prisma.client.systemSetupState.upsert({
      where: { id: "default" },
      create: { id: "default" },
      update: {},
    });
  }

  async getStatus(): Promise<SetupStatus> {
    const env = loadEnv();
    const [setup, userCount, licenseState] = await Promise.all([
      this.ensureSetupState(),
      this.prisma.client.user.count({ where: { deletedAt: null } }),
      this.prisma.client.licenseState.findUnique({ where: { id: "default" } }),
    ]);

    const licenseConfigured = Boolean(
      env.LICENSE_KEY && isLicenseKeyFormat(env.LICENSE_KEY) && licenseState?.licenseKeyHash,
    );

    const needsSetup = !setup.completed && (userCount === 0 || !licenseConfigured);

    return {
      needsSetup,
      completed: setup.completed,
      hasUsers: userCount > 0,
      licenseConfigured,
      cloudConfigured: Boolean(env.LICENSE_SERVER_URL),
      licenseServerUrl: env.LICENSE_SERVER_URL ?? null,
    };
  }

  async registerFreeLicense(email: string, serverUrl?: string): Promise<{ licenseKey: string; plan: string }> {
    const env = loadEnv();
    const base = (serverUrl ?? env.LICENSE_SERVER_URL)?.replace(/\/$/, "");
    if (!base) {
      throw new BadRequestException({
        error: {
          code: "LICENSE_SERVER_REQUIRED",
          message: "Configure LICENSE_SERVER_URL para obter licença free automaticamente.",
        },
      });
    }
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (env.LICENSE_REGISTER_SECRET) {
      headers["X-Register-Secret"] = env.LICENSE_REGISTER_SECRET;
    }
    const res = await fetch(`${base}/v1/licenses/register`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email, plan: "free" }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new BadRequestException({
        error: { code: "REGISTER_FAILED", message: body.error?.message ?? "Falha ao registrar licença." },
      });
    }
    const data = (await res.json()) as { licenseKey: string; plan: string };
    return { licenseKey: data.licenseKey, plan: data.plan };
  }

  async completeSetup(input: {
    organizationName: string;
    adminEmail: string;
    adminPassword: string;
    adminName?: string;
    licenseKey: string;
    licenseServerUrl?: string;
  }) {
    const status = await this.getStatus();
    if (!status.needsSetup && status.completed) {
      throw new BadRequestException({ error: { code: "SETUP_DONE", message: "Setup já concluído." } });
    }

    const orgName = input.organizationName.trim();
    const email = input.adminEmail.trim().toLowerCase();
    const licenseKey = input.licenseKey.trim();

    if (!orgName || !email || input.adminPassword.length < 8) {
      throw new BadRequestException({ error: { code: "VALIDATION_ERROR", message: "Dados inválidos." } });
    }
    if (!isLicenseKeyFormat(licenseKey)) {
      throw new BadRequestException({ error: { code: "INVALID_LICENSE", message: "LICENSE_KEY inválida." } });
    }

    if (input.licenseServerUrl) {
      process.env.LICENSE_SERVER_URL = input.licenseServerUrl.replace(/\/$/, "");
    }
    process.env.LICENSE_KEY = licenseKey;

    const slug = orgName
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "org";

    const passwordHash = await hashPassword(input.adminPassword);

    let org = await this.prisma.client.organization.findFirst({ where: { slug: "default" } });
    if (!org) {
      org = await this.prisma.client.organization.findFirst({ where: { slug } });
    }
    if (!org) {
      org = await this.prisma.client.organization.create({
        data: { name: orgName, slug },
      });
    } else {
      org = await this.prisma.client.organization.update({
        where: { id: org.id },
        data: { name: orgName },
      });
    }

    let user = await this.prisma.client.user.findUnique({ where: { email } });
    if (!user) {
      user = await this.prisma.client.user.create({
        data: {
          email,
          passwordHash,
          name: input.adminName?.trim() || "Administrador",
        },
      });
    } else {
      await this.prisma.client.user.update({
        where: { id: user.id },
        data: { passwordHash, name: input.adminName?.trim() || user.name },
      });
    }

    await this.prisma.client.organizationMember.upsert({
      where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
      create: { organizationId: org.id, userId: user.id, role: "owner" },
      update: { role: "owner" },
    });

    await this.license.activateLicenseKey(licenseKey);

    if (LicenseCloudClient.fromEnv()) {
      await this.license.syncWithCloud("activate").catch(() => undefined);
    }

    await this.prisma.client.systemSetupState.update({
      where: { id: "default" },
      data: { completed: true, completedAt: new Date() },
    });

    return {
      ok: true,
      organization: { id: org.id, name: org.name, slug: org.slug },
      admin: { email: user.email },
    };
  }
}
