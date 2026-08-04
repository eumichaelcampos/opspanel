import { describe, expect, it } from "vitest";
import {
  isExistingWordOpsServer,
  isStepDone,
  onboardingProgress,
  resolveExistingServerInventory,
  resolveOnboardingSteps,
  serverNeedsOnboarding,
  type ServerOnboardingContext,
} from "./wordops-server-onboarding.js";

const existingStack = [
  { id: "nginx", installed: true, running: true, status: "running" },
  { id: "mysql", installed: true, running: true, status: "running" },
  { id: "fail2ban", installed: true, running: true, status: "running" },
  { id: "ufw", installed: true, running: true, status: "running" },
];

function ctx(partial: Partial<ServerOnboardingContext>): ServerOnboardingContext {
  return {
    credentialConfigured: true,
    status: "healthy",
    lastConnectedAt: "2026-01-01T00:00:00.000Z",
    wordopsVersion: null,
    lastSyncedAt: null,
    siteCount: 0,
    stackComponents: undefined,
    onboardingSnapshot: null,
    onboardingCompletedAt: null,
    ...partial,
  };
}

describe("isExistingWordOpsServer", () => {
  it("detects server with WordOps and web stack", () => {
    expect(
      isExistingWordOpsServer(
        ctx({ wordopsVersion: "3.22.0", stackComponents: existingStack }),
      ),
    ).toBe(true);
  });

  it("does not treat fresh install mid-wizard as existing", () => {
    expect(isExistingWordOpsServer(ctx({ wordopsVersion: "3.22.0" }))).toBe(false);
  });
});

describe("existing WordOps onboarding", () => {
  it("marks provision steps done and only requires sync", () => {
    const base = ctx({
      wordopsVersion: "3.22.0",
      stackComponents: existingStack,
    });

    expect(isStepDone(base, "wordops_install")).toBe(true);
    expect(isStepDone(base, "system_update")).toBe(true);
    expect(isStepDone(base, "stack_install")).toBe(true);
    expect(isStepDone(base, "stack_verify")).toBe(true);
    expect(isStepDone(base, "ufw_ports")).toBe(true);
    expect(isStepDone(base, "sync_inventory")).toBe(false);
    expect(isStepDone(base, "ready")).toBe(false);

    const steps = resolveOnboardingSteps(base);
    expect(onboardingProgress(steps)).toBeGreaterThan(70);
    expect(serverNeedsOnboarding(base)).toBe(false);
  });

  it("builds inventory of installed and available components", () => {
    const inventory = resolveExistingServerInventory(
      ctx({ wordopsVersion: "3.22.0", stackComponents: existingStack, siteCount: 2 }),
    );
    expect(inventory.installed.map((i) => i.id)).toEqual(
      expect.arrayContaining(["nginx", "mysql", "fail2ban", "ufw"]),
    );
    expect(inventory.available.some((i) => i.id === "netdata")).toBe(true);
    expect(inventory.needsHealthScan).toBe(false);
  });

  it("considers server ready after inventory sync", () => {
    const ready = ctx({
      wordopsVersion: "3.22.0",
      stackComponents: existingStack,
      lastSyncedAt: "2026-01-02T00:00:00.000Z",
    });

    expect(isStepDone(ready, "sync_inventory")).toBe(true);
    expect(isStepDone(ready, "ready")).toBe(true);
    expect(serverNeedsOnboarding(ready)).toBe(false);

    const steps = resolveOnboardingSteps(ready);
    expect(steps.find((s) => s.id === "ready")?.status).toBe("done");
    expect(onboardingProgress(steps)).toBeGreaterThanOrEqual(80);
  });
});
