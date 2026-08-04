/**
 * Deploy OpsPanel client em VPS via SSH (credenciais do Server no banco local).
 * Uso: npx tsx apps/worker/scripts/deploy-client.ts [serverId]
 */
import { createReadStream, existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "ssh2";
import { loadSshTargetForServer } from "../src/server-credentials.js";

const serverId = process.argv[2] ?? "0ad1a334-7f7d-4dd0-82e4-d6d4dacb7edf";
const root = resolve(process.cwd(), "../..");
const hostIp = "143.95.220.80";

const secrets = {
  SESSION_SECRET: "r/8mDefjLZsh8T+jVVWxd85LpB8IabVp4/Fv1U/N3yU=",
  CREDENTIALS_ENCRYPTION_KEY: "1qde98w4xNDXuGxPnfAI4Ci04CZ9qUjK5QXXRBA5K5E=",
  LICENSE_KEY: "oplic_live_L0SsjgLOwqMmvXt6JUFIXQQqum5ZP_5k",
  LICENSE_SIGNING_SECRET: "8G6Q7ydi6vZACXRY+CF7E2bJKdVlYQtmi2Z5NeTObEwPq5Gqy2eC5QLMa+42MfCF",
  LICENSE_REGISTER_SECRET: "hrXcZTEVvRenL0zgxGQKu48Yqa1wmPsk",
};

function execSsh(conn: Client, cmd: string, timeoutMs = 900_000): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve, reject) => {
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
        resolve({ code, out });
      });
    });
  });
}

function uploadFile(conn: Client, local: string, remote: string): Promise<void> {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      const read = createReadStream(local);
      const write = sftp.createWriteStream(remote);
      write.on("close", () => resolve());
      write.on("error", reject);
      read.on("error", reject);
      read.pipe(write);
    });
  });
}

const target = await loadSshTargetForServer(serverId);
console.log(`Deploy OpsPanel client -> ${target.username}@${target.host}:${target.port}`);

const tarPath = join(tmpdir(), "opspanel-deploy.tgz");
console.log("Empacotando...", tarPath);

const { execSync } = await import("node:child_process");
try {
  execSync(
    `tar -czf "${tarPath}" --exclude=node_modules --exclude=.git --exclude=.next --exclude=dist --exclude=.turbo --exclude=coverage -C "${root}" .`,
    { stdio: "inherit", shell: true },
  );
} catch (e) {
  console.error("Falha ao criar tar:", e);
  process.exit(1);
}

const conn = new Client();
await new Promise<void>((resolve, reject) => {
  conn.on("ready", () => resolve()).on("error", reject).connect({
    host: target.host,
    port: target.port,
    username: target.username,
    password: target.password,
    privateKey: target.privateKey,
    readyTimeout: 30000,
  });
});

console.log("Enviando pacote...");
await uploadFile(conn, tarPath, "/root/opspanel-deploy.tgz");

const envExports = Object.entries(secrets)
  .map(([k, v]) => `export ${k}='${v.replace(/'/g, "'\\''")}'`)
  .join("\n");

const remoteCmd = `
set -e
${envExports}
export HOST_IP='${hostIp}'
export WEB_URL='http://${hostIp}:3000'
export API_URL='http://${hostIp}:3001'
mkdir -p /root/opspanel
cd /root/opspanel
if [ -f /root/opspanel-deploy.tgz ]; then tar -xzf /root/opspanel-deploy.tgz -C /root/opspanel; fi
find /root/opspanel -name '*.sh' -exec sed -i 's/\\r$//' {} +
sed -i 's/\\r$//' scripts/deploy-vps/install-remote.sh
chmod +x scripts/deploy-vps/install-remote.sh
bash scripts/deploy-vps/install-remote.sh
`;

console.log("\nInstalando no servidor (pode levar 10-15 min)...\n");
const result = await execSsh(conn, remoteCmd, 900_000);
conn.end();

await rm(tarPath, { force: true });

if (result.code !== 0) {
  console.error("\nDeploy falhou, codigo:", result.code);
  process.exit(1);
}

console.log("\nDeploy concluido.");
console.log(`Painel: http://${hostIp}:3000/setup`);
