import { describe, expect, it } from "vitest";
import { buildSiteManageResultSummary } from "./wordops-site-manage.js";

describe("buildSiteManageResultSummary", () => {
  it("confirms SSL when enabled", () => {
    expect(buildSiteManageResultSummary("letsencrypt", { sslEnabled: true })).toContain("SSL ativado");
  });

  it("warns when SSL still inactive", () => {
    expect(buildSiteManageResultSummary("letsencrypt", { sslEnabled: false })).toContain("ainda não aparece ativo");
  });

  it("confirms wprocket stack", () => {
    expect(buildSiteManageResultSummary("update_wprocket", { siteType: "wprocket" })).toContain("WP Rocket");
  });
});
