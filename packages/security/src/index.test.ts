import { describe, expect, it } from "vitest";
import { decryptJson, encryptJson, redactSecrets } from "./index.js";

describe("encryption", () => {
  const key = Buffer.alloc(32, 7).toString("base64");

  it("roundtrips json", () => {
    const payload = encryptJson({ user: "root", privateKey: "secret" }, key);
    const decoded = decryptJson<{ user: string; privateKey: string }>(payload, key);
    expect(decoded.user).toBe("root");
  });
});

describe("redactSecrets", () => {
  it("redacts private keys", () => {
    const input = "key -----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----";
    expect(redactSecrets(input)).not.toContain("BEGIN OPENSSH");
  });
});
