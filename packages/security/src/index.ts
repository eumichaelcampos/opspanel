import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;
const KEY_VERSION = 1;

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
}

function decodeKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) {
    throw new Error("CREDENTIALS_ENCRYPTION_KEY must decode to 32 bytes");
  }
  return key;
}

export function encryptJson(value: unknown, base64Key: string): EncryptedPayload {
  const key = decodeKey(base64Key);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    keyVersion: KEY_VERSION,
  };
}

export function decryptJson<T>(payload: EncryptedPayload, base64Key: string): T {
  const key = decodeKey(base64Key);
  const decipher = createDecipheriv(ALGO, key, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.authTag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString("utf8")) as T;
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}

export async function verifyPassword(hashStr: string, password: string): Promise<boolean> {
  return verify(hashStr, password);
}

const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |OPENSSH )?PRIVATE KEY-----/g,
  /(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*\S+/gi,
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "[REDACTED]");
  }
  return out;
}
