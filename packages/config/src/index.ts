import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  API_PORT: z.coerce.number().default(3001),
  API_URL: z.string().url(),
  WEB_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  CREDENTIALS_ENCRYPTION_KEY: z.string().min(32),
  SEED_ADMIN_EMAIL: z
    .string()
    .refine((v) => /^[^\s@]+@[^\s@]+$/.test(v), { message: "Invalid email" })
    .optional(),
  SEED_ADMIN_PASSWORD: z.string().min(8).optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().optional(),
  CLOUDFLARE_OAUTH_CLIENT_ID: z.string().min(8).optional(),
  CLOUDFLARE_OAUTH_CLIENT_SECRET: z.string().min(8).optional(),
  /** Scopes separados por espaço. Devem coincidir com o OAuth client na Cloudflare. */
  CLOUDFLARE_OAUTH_SCOPES: z
    .string()
    .optional()
    .default(
      "offline_access zone.read dns.write zone_settings.write page_rules.write",
    ),
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(8).optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(8).optional(),
  /** Esta instância é o hub OAuth (um Client Google para todos os painéis). */
  GOOGLE_OAUTH_BROKER_ENABLED: z.enum(["true", "false", "1", "0"]).optional(),
  /** Origem do hub, usada pelas instalações cliente. Ex.: https://license.exemplo.com */
  GOOGLE_OAUTH_BROKER_URL: z.string().url().optional(),
  /** URL pública do hub registrada no Google Cloud (redirect URI). */
  GOOGLE_OAUTH_BROKER_PUBLIC_URL: z.string().url().optional(),
  LICENSE_KEY: z.string().min(20).optional(),
  LICENSE_PLAN: z.enum(["free", "pro", "business", "full_free"]).default("free"),
  LICENSE_ENTITLEMENTS_JWT: z.string().optional(),
  LICENSE_SIGNING_SECRET: z.string().min(32).optional(),
  LICENSE_SERVER_URL: z.string().url().optional(),
  LICENSE_REGISTER_SECRET: z.string().min(16).optional(),
  EMAIL_PROVIDER: z.enum(["atriomail", "none"]).optional().default("atriomail"),
  ATRIOMAIL_API_URL: z.string().url().optional(),
  ATRIOMAIL_API_KEY: z.string().min(8).optional(),
  ATRIOMAIL_MX_HOST: z.string().min(3).optional(),
  ATRIOMAIL_SPF_INCLUDE: z.string().min(3).optional(),
  EMAIL_WEBMAIL_BASE_URL: z.string().url().optional(),
  EMAIL_DELIVERY_PROVIDER: z.enum(["resend", "none"]).optional().default("resend"),
  RESEND_API_KEY: z.string().min(8).optional(),
  APP_VERSION: z.string().default("1.0.0"),
  UPDATE_GITHUB_REPO: z.string().default("eumichaelcampos/opspanel"),
});

export type AppEnv = z.infer<typeof envSchema>;

export { compareVersions, isNewerVersion, parseVersion } from "./semver.js";

const WEAK_SECRETS = new Set([
  "change-me-session-secret-min-32-chars!!",
  "change-me-base64-32-bytes-key-here=",
  "ChangeMe123!",
]);

function assertProductionSecrets(env: AppEnv) {
  if (env.NODE_ENV !== "production") return;
  if (WEAK_SECRETS.has(env.SESSION_SECRET)) {
    throw new Error("Production: SESSION_SECRET must be a strong random value.");
  }
  if (WEAK_SECRETS.has(env.CREDENTIALS_ENCRYPTION_KEY)) {
    throw new Error("Production: CREDENTIALS_ENCRYPTION_KEY must be a strong random value.");
  }
  if (env.SEED_ADMIN_PASSWORD && WEAK_SECRETS.has(env.SEED_ADMIN_PASSWORD)) {
    throw new Error("Production: change SEED_ADMIN_PASSWORD before seeding.");
  }
  if (!env.LICENSE_KEY) {
    throw new Error("Production: LICENSE_KEY is required (generate with scripts/generate-license.mjs).");
  }
}

export const DEFAULT_GOOGLE_OAUTH_BROKER_URL = "https://publisher.michaelcampos.com.br/v1";

export function isGoogleOAuthBrokerHub(env: AppEnv): boolean {
  return env.GOOGLE_OAUTH_BROKER_ENABLED === "true" || env.GOOGLE_OAUTH_BROKER_ENABLED === "1";
}

/** Origem do hub OAuth. Por padrão é o Publisher; o hub local só entra se GOOGLE_OAUTH_BROKER_ENABLED=true. */
export function googleOAuthBrokerBaseUrl(env: AppEnv): string | null {
  const explicit = env.GOOGLE_OAUTH_BROKER_URL?.replace(/\/$/, "");
  if (explicit) return explicit;
  if (isGoogleOAuthBrokerHub(env)) {
    return (env.GOOGLE_OAUTH_BROKER_PUBLIC_URL || env.WEB_URL).replace(/\/$/, "");
  }
  return DEFAULT_GOOGLE_OAUTH_BROKER_URL;
}

export function googleOAuthBrokerEndpoint(
  base: string,
  leaf: "start" | "callback" | "redeem" | "refresh",
): string {
  const origin = base.replace(/\/$/, "");
  if (origin.endsWith("/oauth/google")) return `${origin}/${leaf}`;
  if (origin.endsWith("/api/v1") || origin.endsWith("/v1")) return `${origin}/oauth/google/${leaf}`;
  return `${origin}/api/v1/oauth/google/${leaf}`;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${message}`);
  }
  assertProductionSecrets(parsed.data);
  return parsed.data;
}
