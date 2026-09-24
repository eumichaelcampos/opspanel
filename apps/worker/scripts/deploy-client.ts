/**
 * Deploy OpsPanel client em VPS via SSH.
 * Uso:
 *   OPSPANEL_SSH_HOST=x.x.x.x OPSPANEL_SSH_PASSWORD=... \
 *   SESSION_SECRET=... CREDENTIALS_ENCRYPTION_KEY=... \
 *   npx tsx apps/worker/scripts/deploy-client.ts
 *
 * LICENSE_KEY / SIGNING / REGISTER não são necessários no install.
 * A licença é obtida em /setup após o painel subir.
 *
 * Não versionar segredos neste arquivo. Use variáveis de ambiente.
 */
import { createReadStream, existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "ssh2";

const root = resolve(process.cwd(), "../..");
const hostIp = process.env.OPSPANEL_SSH_HOST;
const sshPort = Number(process.env.OPSPANEL_SSH_PORT ?? "22");
const sshUser = process.env.OPSPANEL_SSH_USER ?? "root";
const sshPassword = process.env.OPSPANEL_SSH_PASSWORD;

const required = ["SESSION_SECRET", "CREDENTIALS_ENCRYPTION_KEY"] as const;

for (const key of required) {
  if (!process.env[key]) {
    console.error(`Defina ${key} no ambiente.`);
    process.exit(1);
  }
}
if (!hostIp || !sshPassword) {
  console.error("Defina OPSPANEL_SSH_HOST e OPSPANEL_SSH_PASSWORD.");
  process.exit(1);
}

const secrets = {
  SESSION_SECRET: process.env.SESSION_SECRET!,
  CREDENTIALS_ENCRYPTION_KEY: process.env.CREDENTIALS_ENCRYPTION_KEY!,
};

function execSsh(conn: Client, cmd: string, timeoutMs = 900_000): Promise<{ code: number | null; out: string }> {
  return new Promise((resolveExec, reject) => {
    conn.exec(cmd, { pty: true }, (err, stream) => {
      if (err) return reject(err);
      let out = "";
      const timer = setTimeout(() => {
        stream.close();
        reject(new Error(`Timeout (${timeoutMs}ms): ${cmd.slice(0, 80)}`));
      }, timeoutMs);
      stream.on("data", (d: Buffer) => {
        const t = d.toString();
        out += t;
        process.stdout.write(t);
      });
      stream.stderr.on("data", (d: Buffer) => process.stderr.write(d.toString()));
      stream.on("close", (code) => {
        clearTimeout(timer);
        resolveExec({ code, out });
      });
    });
  });
}

async function uploadDir(sftp: import("ssh2").SFTPWrapper, localDir: string, remoteDir: string) {
  // implementação mínima: o script completo de upload fica no histórico interno;
  // este arquivo público só documenta o contrato de env sem secrets.
  void sftp;
  void localDir;
  void remoteDir;
  throw new Error("Use scripts/deploy-vps/install-remote.sh no servidor alvo (instalação limpa).");
}

void uploadDir;
void createReadStream;
void existsSync;
void mkdir;
void rm;
void tmpdir;
void join;
void secrets;

console.log(`Host alvo: ${hostIp}:${sshPort} user=${sshUser}`);
console.log("Para instalação limpa no VPS, rode no servidor:");
console.log("  bash scripts/deploy-vps/install-remote.sh");
console.log("Este script não embute mais senhas/licenças no repositório.");

const conn = new Client();
await new Promise<void>((res, rej) => {
  conn.on("ready", () => res()).on("error", rej).connect({
    host: hostIp,
    port: sshPort,
    username: sshUser,
    password: sshPassword,
  });
});
const { code } = await execSsh(conn, "echo connected && uname -a");
conn.end();
process.exit(code === 0 ? 0 : 1);
