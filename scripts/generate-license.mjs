#!/usr/bin/env node
/**
 * Gera LICENSE_KEY + JWT de entitlements para desenvolvimento.
 * Uso: node scripts/generate-license.mjs [free|pro|business]
 */
import { createHmac, randomBytes } from "node:crypto";

const plan = process.argv[2] ?? "free";
const plans = {
  free: { maxServers: 1, maxSites: 10, maxJobsPerMonth: 100, maxApiKeys: 1, maxMembers: 2, aiAssistant: false, mcpEnabled: true },
  pro: { maxServers: 5, maxSites: 100, maxJobsPerMonth: 5000, maxApiKeys: 5, maxMembers: 10, aiAssistant: true, mcpEnabled: true },
  business: { maxServers: null, maxSites: null, maxJobsPerMonth: null, maxApiKeys: 20, maxMembers: null, aiAssistant: true, mcpEnabled: true },
};

if (!plans[plan]) {
  console.error("Plano inválido. Use: free, pro ou business");
  process.exit(1);
}

const signingSecret = process.env.LICENSE_SIGNING_SECRET ?? "dev-license-signing-secret-32chars!";
const keyBytes = randomBytes(24).toString("base64url");
const licenseKey = `oplic_test_${keyBytes}`;

const entitlements = { plan, ...plans[plan] };
const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const payload = Buffer.from(JSON.stringify({ ...entitlements, iat: now, exp: now + 86400 * 365 })).toString("base64url");
const data = `${header}.${payload}`;
const sig = createHmac("sha256", signingSecret).update(data).digest("base64url");
const jwt = `${data}.${sig}`;

console.log("\n=== OpsPanel License (dev) ===\n");
console.log(`LICENSE_KEY=${licenseKey}`);
console.log(`LICENSE_PLAN=${plan}`);
console.log(`LICENSE_SIGNING_SECRET=${signingSecret}`);
console.log(`LICENSE_ENTITLEMENTS_JWT=${jwt}`);
console.log("\nCole no .env e reinicie a API.\n");
