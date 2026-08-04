import { Client } from "ssh2";
import { ConnectionResult } from "@opspanel/contracts";
import { redactSecrets } from "@opspanel/security";
import {
  RemoteProbes,
  formatRemoteCommand,
  healthCollectProbe,
  parseHealthCollectOutput,
  parseOsPrettyName,
  parseSiteListOutput,
  parseWordOpsVersion,
} from "@opspanel/wordops";
import type { ConnectionHealthHint } from "@opspanel/contracts";

export interface SshTarget {
  host: string;
  port: number;
  username: string;
  privateKey?: string;
  password?: string;
}

export interface SshSession {
  execProbe(probe: readonly string[]): Promise<{ stdout: string; stderr: string; code: number }>;
  close(): void;
}

function execCommand(client: Client, command: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    client.exec(command, (err, stream) => {
      if (err) return reject(err);
      let stdout = "";
      let stderr = "";
      stream
        .on("close", (code: number) => resolve({ stdout, stderr, code: code ?? 0 }))
        .on("data", (data: Buffer) => {
          stdout += data.toString();
        });
      stream.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });
    });
  });
}

export function connectSshSession(target: SshTarget): Promise<SshSession> {
  const client = new Client();
  return new Promise((resolve, reject) => {
    client
      .on("ready", () => {
        resolve({
          async execProbe(probe: readonly string[]) {
            return execCommand(client, formatRemoteCommand(probe));
          },
          close() {
            client.end();
          },
        });
      })
      .on("error", (err) => reject(err))
      .connect({
        host: target.host,
        port: target.port,
        username: target.username,
        privateKey: target.privateKey,
        password: target.password,
        readyTimeout: 15000,
      });
  });
}

export async function testSshConnection(target: SshTarget): Promise<ConnectionResult> {
  const started = Date.now();
  try {
    const session = await connectSshSession(target);
    try {
      const osResult = await session.execProbe(RemoteProbes.osRelease);
      const osRelease = parseOsPrettyName(redactSecrets(osResult.stdout)) ?? undefined;

      let wordopsVersion: string | undefined;
      const woResult = await session.execProbe(RemoteProbes.wordopsVersion);
      if (woResult.code === 0) {
        wordopsVersion = parseWordOpsVersion(redactSecrets(woResult.stdout + woResult.stderr));
      }

      let healthHint: ConnectionHealthHint | undefined;
      if (wordopsVersion) {
        const healthResult = await session.execProbe(healthCollectProbe());
        const snapshot = parseHealthCollectOutput(redactSecrets(healthResult.stdout + healthResult.stderr));
        if (snapshot.stackComponents?.length || snapshot.uptimeSeconds != null) {
          healthHint = {
            stackComponents: snapshot.stackComponents,
            uptimeSeconds: snapshot.uptimeSeconds,
            collectedAt: snapshot.collectedAt,
          };
        }
      }

      return {
        ok: true,
        latencyMs: Date.now() - started,
        osRelease,
        wordopsVersion,
        healthHint,
      };
    } finally {
      session.close();
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Erro desconhecido";
    return {
      ok: false,
      latencyMs: Date.now() - started,
      errorCode: "SERVER_CONNECTION_FAILED",
      errorMessage: `Não foi possível conectar ao servidor (${detail}).`,
    };
  }
}

export async function fetchSiteList(
  target: SshTarget,
): Promise<{ ok: boolean; domains?: string[]; errorMessage?: string; rawPreview?: string }> {
  try {
    const session = await connectSshSession(target);
    try {
      const listResult = await session.execProbe(RemoteProbes.siteList);
      const combinedOutput = redactSecrets(listResult.stdout + listResult.stderr);
      const rawPreview = combinedOutput.slice(0, 500);

      if (listResult.code !== 0) {
        if (/command not found|not found:/i.test(combinedOutput)) {
          return {
            ok: false,
            errorMessage: "WordOps (comando wo) não encontrado no servidor. Instale o WordOps antes de sincronizar.",
            rawPreview,
          };
        }
        return {
          ok: false,
          errorMessage: "WordOps não retornou a lista de sites. Verifique se o WordOps está instalado.",
          rawPreview,
        };
      }

      const parsed = parseSiteListOutput(combinedOutput);
      return { ok: true, domains: parsed.map((p) => p.domain), rawPreview };
    } finally {
      session.close();
    }
  } catch {
    return { ok: false, errorMessage: "Falha ao conectar para sincronizar inventário." };
  }
}
