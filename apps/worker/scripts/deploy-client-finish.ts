/** Finaliza deploy (migrate + build + PM2). Rápido se deps já instaladas. */
import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { Client } from "ssh2";
import { loadSshTargetForServer } from "../src/server-credentials.js";

const serverId = "0ad1a334-7f7d-4dd0-82e4-d6d4dacb7edf";
const root = resolve(import.meta.dirname, "../../..");

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

function execSsh(conn: Client, cmd: string, timeoutMs = 600_000) {
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
console.log(`Finalizando OpsPanel em ${target.host}:${target.port}...\n`);

const conn = new Client();
await new Promise<void>((res, rej) => {
  conn.on("ready", () => res()).on("error", rej).connect({
    host: target.host, port: target.port, username: target.username,
    password: target.password, privateKey: target.privateKey, readyTimeout: 30000,
  });
});

console.log("Enviando fixes...");
await uploadFile(
  conn,
  resolve(root, "apps/worker/src/index.ts"),
  "/root/opspanel/apps/worker/src/index.ts",
);
await uploadFile(
  conn,
  resolve(root, "apps/web/src/components/operation-terminal.tsx"),
  "/root/opspanel/apps/web/src/components/operation-terminal.tsx",
);
await uploadFile(
  conn,
  resolve(root, "apps/web/src/app/sites/new/page.tsx"),
  "/root/opspanel/apps/web/src/app/sites/new/page.tsx",
);
await uploadFile(
  conn,
  resolve(root, "apps/web/src/app/sites/new/new-site-inner.tsx"),
  "/root/opspanel/apps/web/src/app/sites/new/new-site-inner.tsx",
);
await uploadFile(
  conn,
  resolve(root, "apps/web/src/app/setup/page.tsx"),
  "/root/opspanel/apps/web/src/app/setup/page.tsx",
);

const r = await execSsh(conn, `
set -e
export NVM_DIR=/root/.nvm
source "$NVM_DIR/nvm.sh"
nvm use 20
cd /root/opspanel
set -a && source .env && set +a
export SKIP_SEED=1
echo "==> Build"
pnpm build
echo "==> PM2"
pm2 delete opspanel-api opspanel-worker opspanel-web 2>/dev/null || true
pm2 start scripts/deploy-vps/ecosystem.config.cjs
pm2 save
ufw allow 3000/tcp 2>/dev/null || true
ufw allow 3001/tcp 2>/dev/null || true
sleep 3
curl -sf http://127.0.0.1:3001/api/v1/health && echo ""
echo "OK: http://143.95.220.80:3000/setup"
`);
conn.end();
process.exit(r.code ?? 1);
