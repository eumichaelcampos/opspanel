import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { isNewerVersion, loadEnv } from "@opspanel/config";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaService } from "../prisma/prisma.service";

export type UpdateStatus = {
  currentVersion: string;
  latestVersion: string | null;
  changelog: string | null;
  releaseUrl: string | null;
  updateAvailable: boolean;
  dismissed: boolean;
  lastCheckedAt: string | null;
  applyStatus: "idle" | "running" | "success" | "failed";
  applyLog: string | null;
  applyStartedAt: string | null;
  applyFinishedAt: string | null;
  canApply: boolean;
};

type RemoteRelease = {
  version: string;
  changelog: string;
  releaseUrl: string;
};

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

@Injectable()
export class UpdatesService implements OnModuleInit, OnModuleDestroy {
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private applying = false;
  private readonly logger = new Logger(UpdatesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.ensureState();
    void this.checkForUpdates().catch((err) => {
      this.logger.warn(`Initial update check failed: ${err instanceof Error ? err.message : String(err)}`);
    });
    this.checkTimer = setInterval(() => {
      void this.checkForUpdates().catch((err) => {
        this.logger.warn(`Scheduled update check failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, CHECK_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.checkTimer) clearInterval(this.checkTimer);
  }

  private repoRoot(): string {
    return resolve(process.cwd(), "../..");
  }

  private currentVersionFromEnv(): string {
    return loadEnv().APP_VERSION;
  }

  private async ensureState() {
    const envVersion = this.currentVersionFromEnv();
    const existing = await this.prisma.client.systemUpdateState.findUnique({ where: { id: "default" } });
    if (!existing) {
      await this.prisma.client.systemUpdateState.create({
        data: { currentVersion: envVersion },
      });
      return;
    }
    if (isNewerVersion(envVersion, existing.currentVersion)) {
      await this.prisma.client.systemUpdateState.update({
        where: { id: "default" },
        data: { currentVersion: envVersion },
      });
    }
  }

  private async getCurrentVersion(): Promise<string> {
    await this.ensureState();
    const state = await this.prisma.client.systemUpdateState.findUniqueOrThrow({ where: { id: "default" } });
    return state.currentVersion;
  }

  private async fetchFromLicenseServer(baseUrl: string): Promise<RemoteRelease | null> {
    const url = `${baseUrl.replace(/\/$/, "")}/v1/updates/latest`;
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "OpsPanel-Updater" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      version?: string;
      changelog?: string;
      body?: string;
      releaseUrl?: string;
      url?: string;
    };
    if (!data.version?.trim()) return null;
    return {
      version: data.version.trim().replace(/^v/i, ""),
      changelog: (data.changelog ?? data.body ?? "").trim(),
      releaseUrl: (data.releaseUrl ?? data.url ?? "").trim(),
    };
  }

  private async fetchFromGitHub(repo: string): Promise<RemoteRelease | null> {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "OpsPanel-Updater",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { tag_name?: string; body?: string | null; html_url?: string };
    const version = (data.tag_name ?? "").trim().replace(/^v/i, "");
    if (!version) return null;
    return {
      version,
      changelog: (data.body ?? "").trim(),
      releaseUrl: data.html_url ?? "",
    };
  }

  private async fetchRemoteRelease(): Promise<RemoteRelease | null> {
    const env = loadEnv();
    let release: RemoteRelease | null = null;

    if (env.LICENSE_SERVER_URL) {
      try {
        release = await this.fetchFromLicenseServer(env.LICENSE_SERVER_URL);
      } catch (err) {
        this.logger.warn(
          `License server update check failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (!release) {
      try {
        release = await this.fetchFromGitHub(env.UPDATE_GITHUB_REPO);
      } catch (err) {
        this.logger.warn(`GitHub update check failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return release;
  }

  async checkForUpdates(): Promise<UpdateStatus> {
    await this.ensureState();
    const current = await this.getCurrentVersion();
    const remote = await this.fetchRemoteRelease();
    const now = new Date();

    const latestVersion = remote?.version ?? null;
    const updateAvailable = latestVersion ? isNewerVersion(latestVersion, current) : false;

    await this.prisma.client.systemUpdateState.update({
      where: { id: "default" },
      data: {
        currentVersion: current,
        latestVersion,
        latestChangelog: remote?.changelog ?? null,
        latestReleaseUrl: remote?.releaseUrl ?? null,
        updateAvailable,
        lastCheckedAt: now,
      },
    });

    if (updateAvailable) {
      this.logger.log(`Update available: ${current} -> ${latestVersion}`);
    }

    return this.getGlobalStatus(false);
  }

  async getStatusForUser(userId: string, canApply: boolean): Promise<UpdateStatus> {
    await this.ensureState();
    const state = await this.prisma.client.systemUpdateState.findUniqueOrThrow({ where: { id: "default" } });
    const latest = state.latestVersion;
    let dismissed = false;
    if (latest && state.updateAvailable) {
      const row = await this.prisma.client.userUpdateDismissal.findUnique({
        where: { userId_version: { userId, version: latest } },
      });
      dismissed = Boolean(row);
    }
    return this.mapState(state, dismissed, canApply);
  }

  private async getGlobalStatus(dismissed: boolean): Promise<UpdateStatus> {
    const state = await this.prisma.client.systemUpdateState.findUniqueOrThrow({ where: { id: "default" } });
    return this.mapState(state, dismissed, false);
  }

  private mapState(
    state: {
      currentVersion: string;
      latestVersion: string | null;
      latestChangelog: string | null;
      latestReleaseUrl: string | null;
      updateAvailable: boolean;
      lastCheckedAt: Date | null;
      applyStatus: string;
      applyLog: string | null;
      applyStartedAt: Date | null;
      applyFinishedAt: Date | null;
    },
    dismissed: boolean,
    canApply: boolean,
  ): UpdateStatus {
    const applyStatus = state.applyStatus as UpdateStatus["applyStatus"];
    return {
      currentVersion: state.currentVersion,
      latestVersion: state.latestVersion,
      changelog: state.latestChangelog,
      releaseUrl: state.latestReleaseUrl,
      updateAvailable: state.updateAvailable,
      dismissed,
      lastCheckedAt: state.lastCheckedAt?.toISOString() ?? null,
      applyStatus: ["idle", "running", "success", "failed"].includes(applyStatus) ? applyStatus : "idle",
      applyLog: state.applyLog,
      applyStartedAt: state.applyStartedAt?.toISOString() ?? null,
      applyFinishedAt: state.applyFinishedAt?.toISOString() ?? null,
      canApply,
    };
  }

  async dismiss(userId: string, version: string): Promise<{ ok: true }> {
    const v = version.trim().replace(/^v/i, "");
    if (!v) throw new Error("Versão inválida.");
    await this.prisma.client.userUpdateDismissal.upsert({
      where: { userId_version: { userId, version: v } },
      create: { userId, version: v },
      update: { dismissedAt: new Date() },
    });
    return { ok: true };
  }

  private updateScriptPath(): { root: string; script: string } {
    const root = this.repoRoot();
    const script =
      process.platform === "win32"
        ? resolve(root, "scripts/update.ps1")
        : resolve(root, "scripts/update.sh");
    return { root, script };
  }

  async applyUpdate(): Promise<{ ok: true; message: string }> {
    if (this.applying) {
      throw new Error("Uma atualização já está em andamento.");
    }

    const state = await this.prisma.client.systemUpdateState.findUniqueOrThrow({ where: { id: "default" } });
    if (!state.updateAvailable || !state.latestVersion) {
      throw new Error("Nenhuma atualização disponível.");
    }
    if (state.applyStatus === "running") {
      throw new Error("Uma atualização já está em andamento.");
    }

    const { root, script } = this.updateScriptPath();
    if (!existsSync(script)) {
      throw new Error(`Script de atualização não encontrado: ${script}`);
    }

    this.applying = true;
    const startedAt = new Date();
    let log = "";

    await this.prisma.client.systemUpdateState.update({
      where: { id: "default" },
      data: {
        applyStatus: "running",
        applyLog: "Iniciando atualização...\n",
        applyStartedAt: startedAt,
        applyFinishedAt: null,
      },
    });

    const appendLog = async (chunk: string) => {
      log += chunk;
      if (log.length > 120_000) log = log.slice(-120_000);
      await this.prisma.client.systemUpdateState.update({
        where: { id: "default" },
        data: { applyLog: log },
      });
    };

    try {
      const exitCode = await new Promise<number>((resolvePromise, reject) => {
        const isWin = process.platform === "win32";
        const child = isWin
          ? spawn(
              "powershell.exe",
              ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],
              { cwd: root, env: process.env },
            )
          : spawn("bash", [script], { cwd: root, env: process.env });

        child.stdout.on("data", (buf: Buffer) => {
          void appendLog(buf.toString());
        });
        child.stderr.on("data", (buf: Buffer) => {
          void appendLog(buf.toString());
        });
        child.on("error", reject);
        child.on("close", (code) => resolvePromise(code ?? 1));
      });

      const finishedAt = new Date();
      if (exitCode !== 0) {
        await appendLog(`\n[ERRO] Script encerrou com código ${exitCode}.\n`);
        await this.prisma.client.systemUpdateState.update({
          where: { id: "default" },
          data: { applyStatus: "failed", applyFinishedAt: finishedAt },
        });
        throw new Error(`Atualização falhou (código ${exitCode}). Veja o log para detalhes.`);
      }

      await appendLog("\n[OK] Atualização concluída. Reinicie API, worker e web.\n");
      await this.prisma.client.systemUpdateState.update({
        where: { id: "default" },
        data: {
          applyStatus: "success",
          applyFinishedAt: finishedAt,
          currentVersion: state.latestVersion,
          updateAvailable: false,
        },
      });

      return {
        ok: true,
        message: "Atualização aplicada. Reinicie os serviços e recarregue a página.",
      };
    } finally {
      this.applying = false;
    }
  }
}
