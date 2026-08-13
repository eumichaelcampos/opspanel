/**
 * Diagnóstico SSH de um servidor cadastrado no banco local.
 * Uso: npx tsx apps/worker/scripts/test-ssh.ts <serverId>
 * Não embute IDs nem IPs de cliente.
 */
import { loadSshTargetForServer } from "../src/server-credentials.js";
import { testSshConnection } from "../src/ssh-executor.js";
import { Client } from "ssh2";

const serverId = process.argv[2];
if (!serverId) {
  console.error("Uso: npx tsx apps/worker/scripts/test-ssh.ts <serverId>");
  process.exit(1);
}

async function tcpProbe(host: string, port: number, timeoutMs = 8000): Promise<{ ok: boolean; ms: number; error?: string }> {
  const net = await import("node:net");
  const started = Date.now();
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port, timeout: timeoutMs });
    socket.on("connect", () => {
      socket.destroy();
      resolve({ ok: true, ms: Date.now() - started });
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve({ ok: false, ms: Date.now() - started, error: "TCP timeout" });
    });
    socket.on("error", (err) => {
      resolve({ ok: false, ms: Date.now() - started, error: err.message });
    });
  });
}

async function rawSshHandshake(target: Awaited<ReturnType<typeof loadSshTargetForServer>>) {
  const client = new Client();
  return new Promise<{ ok: boolean; error?: string }>((resolve) => {
    const timer = setTimeout(() => {
      client.end();
      resolve({ ok: false, error: "SSH readyTimeout (15s)" });
    }, 16000);
    client
      .on("ready", () => {
        clearTimeout(timer);
        client.end();
        resolve({ ok: true });
      })
      .on("error", (err) => {
        clearTimeout(timer);
        resolve({ ok: false, error: err.message });
      })
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

const target = await loadSshTargetForServer(serverId);
console.log("=== OpsPanel SSH Diagnostic ===");
console.log(`Server ID: ${serverId}`);
console.log(`Target: ${target.username}@${target.host}:${target.port}`);
console.log(`Auth: ${target.privateKey ? "private key" : "password"}`);

const tcp = await tcpProbe(target.host, target.port);
console.log("\n[TCP] Port reachability:", tcp);

const handshake = await rawSshHandshake(target);
console.log("\n[SSH] Handshake:", handshake);

const result = await testSshConnection(target);
console.log("\n[SSH] Full test:", result);

process.exit(result.ok ? 0 : 1);
