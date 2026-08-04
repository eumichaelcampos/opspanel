import { createHmac, timingSafeEqual } from "node:crypto";
import type { Entitlements, PlanTier } from "./plans.js";
import { entitlementsForPlan } from "./plans.js";

const LICENSE_PREFIX = "oplic_";

export function generateLicenseKey(tier: "live" | "test" = "live"): string {
  const bytes = createHmac("sha256", "opspanel-license-gen")
    .update(`${Date.now()}-${Math.random()}`)
    .digest("base64url");
  return `${LICENSE_PREFIX}${tier}_${bytes.slice(0, 40)}`;
}

export function isLicenseKeyFormat(key: string): boolean {
  return key.startsWith(LICENSE_PREFIX) && key.length >= 20;
}

function base64UrlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? padded : padded + "=".repeat(4 - (padded.length % 4));
  return Buffer.from(pad, "base64");
}

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64url");
}

export function signEntitlementsJwt(entitlements: Entitlements, secret: string, expiresInSec = 86400 * 30): string {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64UrlEncode(
    JSON.stringify({
      ...entitlements,
      iat: now,
      exp: now + expiresInSec,
    }),
  );
  const data = `${header}.${payload}`;
  const sig = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

const entitlementsSchemaKeys = [
  "plan",
  "maxServers",
  "maxSites",
  "maxJobsPerMonth",
  "maxApiKeys",
  "maxMembers",
  "aiAssistant",
  "mcpEnabled",
] as const;

function parseEntitlementsPayload(raw: Record<string, unknown>): Entitlements {
  const plan = raw.plan as PlanTier;
  if (!["free", "pro", "business"].includes(plan)) {
    throw new Error("Invalid plan in license JWT.");
  }
  return {
    plan,
    maxServers: raw.maxServers as number | null,
    maxSites: raw.maxSites as number | null,
    maxJobsPerMonth: raw.maxJobsPerMonth as number | null,
    maxApiKeys: raw.maxApiKeys as number | null,
    maxMembers: raw.maxMembers as number | null,
    aiAssistant: Boolean(raw.aiAssistant),
    mcpEnabled: raw.mcpEnabled !== false,
  };
}

export function verifyEntitlementsJwt(token: string, secret: string): Entitlements {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT format.");
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];
  const data = `${headerB64}.${payloadB64}`;
  const expected = createHmac("sha256", secret).update(data).digest("base64url");
  const a = Buffer.from(sigB64);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("Invalid license JWT signature.");
  }
  const payload = JSON.parse(base64UrlDecode(payloadB64).toString("utf8")) as Record<string, unknown>;
  const exp = payload.exp as number | undefined;
  if (exp && exp * 1000 < Date.now()) {
    throw new Error("License JWT expired.");
  }
  return parseEntitlementsPayload(payload);
}

export function resolveEntitlementsFromEnv(input: {
  licensePlan?: PlanTier;
  entitlementsJwt?: string;
  signingSecret?: string;
}): Entitlements {
  if (input.entitlementsJwt && input.signingSecret) {
    return verifyEntitlementsJwt(input.entitlementsJwt, input.signingSecret);
  }
  const plan = input.licensePlan ?? "free";
  return entitlementsForPlan(plan);
}

export { entitlementsSchemaKeys };
