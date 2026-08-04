import { describe, expect, it } from "vitest";
import {
  entitlementsForPlan,
  generateLicenseKey,
  isLicenseKeyFormat,
  signEntitlementsJwt,
  verifyEntitlementsJwt,
} from "./index.js";

describe("licensing", () => {
  it("generates valid license key format", () => {
    const key = generateLicenseKey("test");
    expect(isLicenseKeyFormat(key)).toBe(true);
    expect(key.startsWith("oplic_test_")).toBe(true);
  });

  it("signs and verifies entitlements jwt", () => {
    const secret = "test-signing-secret-min-32-chars!!";
    const ent = entitlementsForPlan("pro");
    const jwt = signEntitlementsJwt(ent, secret);
    const parsed = verifyEntitlementsJwt(jwt, secret);
    expect(parsed.plan).toBe("pro");
    expect(parsed.maxServers).toBe(5);
  });
});
