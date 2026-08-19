import { describe, expect, it } from "vitest";
import { computeNextBackupRun } from "./backup-policy.js";

describe("computeNextBackupRun", () => {
  it("returns null when schedule is off", () => {
    expect(computeNextBackupRun("off", 3)).toBeNull();
  });

  it("picks the next daily hour in America/Sao_Paulo", () => {
    const from = new Date("2026-08-17T12:00:00.000Z");
    const next = computeNextBackupRun("daily", 3, from);
    expect(next?.toISOString()).toBe("2026-08-18T06:00:00.000Z");
  });

  it("schedules twice a day", () => {
    const from = new Date("2026-08-17T07:00:00.000Z");
    const next = computeNextBackupRun("every_12h", 3, from);
    expect(next?.toISOString()).toBe("2026-08-17T18:00:00.000Z");
  });
});
