/** Retoma install após upload (sem re-enviar tar). */
import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { Client } from "ssh2";
import { loadSshTargetForServer } from "../src/server-credentials.js";

const serverId = process.argv[2] ?? "0ad1a334-7f7d-4dd0-82e4-d6d4dacb7edf";
const hostIp = "143.95.220.80";
const root = resolve(process.cwd(), "../..");

const secrets = {
  SESSION_SECRET: "r/8mDefjLZsh8T+jVVWxd85LpB8IabVp4/Fv1U/N3yU=",
  CREDENTIALS_ENCRYPTION_KEY: "1qde98w4xNDXuGxPnfAI4Ci04CZ9qUjK5QXXRBA5K5E=",
  LICENSE_KEY: "oplic_live_L0SsjgLOwqMmvXt6JUFIXQQqum5ZP_5k",
  LICENSE_SIGNING_SECRET: "8G6Q7ydi6vZACXRY+CF7E2bJKdVlYQtmi2Z5NeTObEwPq5Gqy2eC5QLMa+42MfCF",
  LICENSE_REGISTER_SECRET: "hrXcZTEVvRenL0zgxGQKu48Yqa1wmPsk",
};

function uploadFile(conn: Client, local: string, remote: string) {
  return new Promise<void>((resolve, reject) => {
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

function execSsh(conn: Client, cmd: string, timeoutMs = 900_000) {
  return new Promise<{ code: number | null }>((resolve, reject) => {
    conn.exec(cmd, { pty: true }, (err, stream) => {
      if (err) return reject(err);
      const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      stream.on("data", (d: Buffer) => process.stdout.write(d.toString()));
      stream.stderr.on("data", (d: Buffer) => process.stderr.write(d.toString()));
      stream.on("close", (code) => { clearTimeout(timer); resolve({ code }); });
    });
  });
}

const target = await loadSshTargetForServer(serverId);
const conn = new Client();
await new Promise<void>((res, rej) => {
  conn.on("ready", () => res()).on("error", rej).connect({
    host: target.host, port: target.port, username: target.username,
    password: target.password, privateKey: target.privateKey, readyTimeout: 30000,
  });
});

await uploadFile(conn, resolve(root, "scripts/deploy-vps/install-remote.sh"), "/root/opspanel/scripts/deploy-vps/install-remote.sh");
await uploadFile(conn, resolve(root, "scripts/deploy-vps/ecosystem.config.cjs"), "/root/opspanel/scripts/deploy-vps/ecosystem.config.cjs");

const envExports = Object.entries(secrets).map(([k, v]) => `export ${k}='${v}'`).join("\n");
const r = await execSsh(conn, `
set -e
${envExports}
export HOST_IP='${hostIp}'
cd /root/opspanel
find . -name '*.sh' -exec sed -i 's/\\r$//' {} +
sed -i 's/\\r$//' scripts/deploy-vps/install-remote.sh
chmod +x scripts/deploy-vps/install-remote.sh
bash scripts/deploy-vps/install-remote.sh
`);
conn.end();
process.exit(r.code ?? 1);
