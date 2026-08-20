/** Atualiza variáveis de e-mail no .env remoto e reinicia PM2. */
import { Client } from "ssh2";

const apiUrl = process.argv[2]?.replace(/\/$/, "");
const loginEmail = process.argv[3];
const loginPassword = process.argv[4];
const serverId = process.argv[5];
const atriomailKey = process.argv[6];
const opsDir = process.argv[7] ?? "/root/opspanel";

if (!apiUrl || !loginEmail || !loginPassword || !serverId || !atriomailKey) {
  console.error(
    "Uso: npx tsx scripts/configure-remote-email-env.ts <apiUrl> <loginEmail> <loginPassword> <serverId> <ATRIOMAIL_API_KEY>",
  );
  process.exit(1);
}

function execSsh(conn: Client, cmd: string, timeoutMs = 120_000) {
  return new Promise<{ code: number | null }>((resolve, reject) => {
    conn.exec(cmd, { pty: true }, (err, stream) => {
      if (err) return reject(err);
      const timer = setTimeout(() => reject(new Error("SSH timeout")), timeoutMs);
      stream.on("data", (d: Buffer) => process.stdout.write(d.toString()));
      stream.stderr.on("data", (d: Buffer) => process.stderr.write(d.toString()));
      stream.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code });
      });
    });
  });
}

const loginRes = await fetch(`${apiUrl}/api/v1/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: loginEmail, password: loginPassword }),
});
if (!loginRes.ok) throw new Error(`login failed: ${loginRes.status}`);
const cookie = loginRes.headers.get("set-cookie")?.split(";")[0];
if (!cookie) throw new Error("missing session cookie");

const cred = (await fetch(`${apiUrl}/api/v1/servers/${serverId}/credential`, {
  headers: { Cookie: cookie },
}).then((r) => r.json())) as {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
};

const conn = new Client();
await new Promise<void>((res, rej) =>
  conn
    .on("ready", () => res())
    .on("error", rej)
    .connect({
      host: cred.host,
      port: cred.port,
      username: cred.username,
      password: cred.password,
      privateKey: cred.privateKey,
      readyTimeout: 30000,
    }),
);

const keyB64 = Buffer.from(atriomailKey, "utf8").toString("base64");
const remoteCmd = `
set -euo pipefail
cd ${opsDir}
test -f .env || touch .env
ATRIO_KEY=$(echo '${keyB64}' | base64 -d)
set_kv() {
  local k="$1" v="$2"
  if grep -q "^\${k}=" .env; then
    sed -i "s|^\${k}=.*|\${k}=\${v}|" .env
  else
    echo "\${k}=\${v}" >> .env
  fi
}
set_kv EMAIL_PROVIDER atriomail
set_kv ATRIOMAIL_API_URL https://api.atriomail.com
set_kv ATRIOMAIL_API_KEY "$ATRIO_KEY"
set_kv ATRIOMAIL_MX_HOST mail.atriomail.com
set_kv ATRIOMAIL_SPF_INCLUDE spf.atriomail.com
set_kv EMAIL_WEBMAIL_BASE_URL https://webmail.atriomail.com
set_kv EMAIL_DELIVERY_PROVIDER none
grep -q '^ATRIOMAIL_API_KEY=' .env && echo 'ATRIOMAIL_API_KEY configurada (valor oculto)'
export NVM_DIR=/root/.nvm
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
pm2 restart opspanel-api opspanel-worker opspanel-web
sleep 3
curl -sf http://127.0.0.1:3001/api/v1/health && echo ""
`;

const result = await execSsh(conn, remoteCmd);
conn.end();
process.exit(result.code ?? 1);
