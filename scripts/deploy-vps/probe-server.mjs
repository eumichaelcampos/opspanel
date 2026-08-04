/**
 * Deploy remoto via SSH (usa credenciais do banco local OpsPanel).
 */
import { Client } from "ssh2";
import { loadSshTargetForServer } from "../../apps/worker/src/server-credentials.js";

const serverId = process.argv[2] ?? "0ad1a334-7f7d-4dd0-82e4-d6d4dacb7edf";

function execSsh(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = "";
      let errOut = "";
      stream.on("data", (d) => { out += d; });
      stream.stderr.on("data", (d) => { errOut += d; });
      stream.on("close", (code) => resolve({ code, out, errOut }));
    });
  });
}

const target = await loadSshTargetForServer(serverId);
const conn = new Client();

await new Promise((resolve, reject) => {
  conn
    .on("ready", resolve)
    .on("error", reject)
    .connect({
      host: target.host,
      port: target.port,
      username: target.username,
      password: target.password,
      privateKey: target.privateKey,
      readyTimeout: 20000,
    });
});

const checks = [
  "uname -a",
  "free -h | head -2",
  "df -h / | tail -1",
  "command -v node || echo NO_NODE",
  "command -v docker || echo NO_DOCKER",
  "command -v pnpm || echo NO_PNPM",
  "docker ps 2>/dev/null | head -5 || echo NO_DOCKER_PS",
  "ss -tlnp | grep -E ':3000|:3001|:5432|:6379' || echo NO_OPS_PORTS",
  "ls -la /root/opspanel 2>/dev/null || echo NO_OPSPANEL_DIR",
];

for (const cmd of checks) {
  const r = await execSsh(conn, cmd);
  console.log(`\n$ ${cmd}\n${r.out}${r.errOut}`.trim());
}

conn.end();
