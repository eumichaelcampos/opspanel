import { describe, expect, it } from "vitest";
import {
  isSiteMigrateDbFailure,
  siteMigrateDbModeLabel,
  siteMigrateDbRecoverySteps,
} from "./site-migrate-onboarding.js";

describe("site migrate db recovery helpers", () => {
  it("labels auto_wpconfig as recommended", () => {
    expect(siteMigrateDbModeLabel("auto_wpconfig")).toMatch(/recomendado/i);
  });

  it("recovery steps include VPS IP", () => {
    const steps = siteMigrateDbRecoverySteps("192.0.2.10");
    expect(steps[0]).toContain("192.0.2.10");
    expect(steps.some((s) => /Arquivo \.sql/i.test(s))).toBe(true);
  });

  it("detects db failures by code and message", () => {
    expect(isSiteMigrateDbFailure(null, "MIGRATE_DB_IMPORT_FAILED")).toBe(true);
    expect(isSiteMigrateDbFailure("Falha ao importar o banco", null)).toBe(true);
    expect(isSiteMigrateDbFailure("Timeout de rede genérico", "OTHER")).toBe(false);
  });
});
