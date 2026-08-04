import { describe, expect, it } from "vitest";
import { loadEnv } from "./index.js";

describe("loadEnv", () => {
  it("loads minimal env", () => {
    const env = loadEnv({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://u:p@localhost:5432/db",
      REDIS_URL: "redis://localhost:6379",
      API_URL: "http://localhost:3001",
      WEB_URL: "http://localhost:3000",
      SESSION_SECRET: "x".repeat(32),
      CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
    });
    expect(env.API_PORT).toBe(3001);
  });
});
