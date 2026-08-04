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
});

export type AppEnv = z.infer<typeof envSchema>;

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
