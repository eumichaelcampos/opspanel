import { describe, expect, it } from "vitest";
import {
  DEFAULT_SITE_CREATION_DRAFT,
  buildSiteCreatePayload,
  getVisibleSiteCreationSteps,
  validateSiteCreationStep,
} from "./wordops-site-onboarding.js";

describe("site creation wizard", () => {
  it("shows wordpress step only for WP types", () => {
    const wpSteps = getVisibleSiteCreationSteps({ ...DEFAULT_SITE_CREATION_DRAFT, siteType: "wprocket" });
    expect(wpSteps.some((s) => s.id === "wordpress")).toBe(true);

    const htmlSteps = getVisibleSiteCreationSteps({ ...DEFAULT_SITE_CREATION_DRAFT, siteType: "html" });
    expect(htmlSteps.some((s) => s.id === "wordpress")).toBe(false);
  });

  it("validates domain on where step", () => {
    expect(
      validateSiteCreationStep("where", { ...DEFAULT_SITE_CREATION_DRAFT, serverId: "x", domain: "invalid" }).ok,
    ).toBe(false);
    expect(
      validateSiteCreationStep("where", {
        ...DEFAULT_SITE_CREATION_DRAFT,
        serverId: "550e8400-e29b-41d4-a716-446655440000",
        domain: "exemplo.com.br",
      }).ok,
    ).toBe(true);
  });

  it("builds API payload from draft", () => {
    const payload = buildSiteCreatePayload({
      ...DEFAULT_SITE_CREATION_DRAFT,
      serverId: "550e8400-e29b-41d4-a716-446655440000",
      domain: "Loja.COM.br",
      siteType: "wprocket",
      cfKey: "key12345678",
      cfEmail: "admin@test.com",
    });
    expect(payload.domain).toBe("loja.com.br");
    expect(payload.siteType).toBe("wprocket");
    expect(payload.cloudflareApiKey).toBe("key12345678");
  });
});
