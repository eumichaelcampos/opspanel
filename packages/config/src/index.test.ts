import { describe, expect, it } from "vitest";
import { googleOAuthBrokerBaseUrl, googleOAuthBrokerEndpoint, isGoogleOAuthBrokerHub, loadEnv } from "./index.js";

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

describe("google oauth broker urls", () => {
  const baseEnv = {
    NODE_ENV: "test" as const,
    DATABASE_URL: "postgresql://u:p@localhost:5432/db",
    REDIS_URL: "redis://localhost:6379",
    API_URL: "http://localhost:3001",
    WEB_URL: "http://10.0.0.8:3000",
    SESSION_SECRET: "x".repeat(32),
    CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
  };

  it("defaults client instances to the publisher hub", () => {
    const env = loadEnv(baseEnv);
    expect(isGoogleOAuthBrokerHub(env)).toBe(false);
    expect(googleOAuthBrokerBaseUrl(env)).toBe("https://publisher.michaelcampos.com.br/v1");
    expect(googleOAuthBrokerEndpoint(googleOAuthBrokerBaseUrl(env)!, "callback")).toBe(
      "https://publisher.michaelcampos.com.br/v1/oauth/google/callback",
    );
  });

  it("uses public hub url when this instance is the broker", () => {
    const env = loadEnv({
      ...baseEnv,
      GOOGLE_OAUTH_BROKER_ENABLED: "true",
      GOOGLE_OAUTH_BROKER_PUBLIC_URL: "https://license.example.com",
    });
    expect(isGoogleOAuthBrokerHub(env)).toBe(true);
    expect(googleOAuthBrokerBaseUrl(env)).toBe("https://license.example.com");
    expect(googleOAuthBrokerEndpoint("https://license.example.com", "callback")).toBe(
      "https://license.example.com/api/v1/oauth/google/callback",
    );
  });
});
