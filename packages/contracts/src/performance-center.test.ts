import { describe, expect, it } from "vitest";
import {
  buildSitePerformanceRecommendations,
  buildServerPerformanceRecommendations,
  summarizePerformance,
} from "./performance-center.js";
import { getPlaybookById, PLAYBOOKS } from "./playbooks.js";
import { alertChannelCreateSchema } from "./alerts.js";

describe("performance advisor", () => {
  it("flags missing ssl and weak cache", () => {
    const report = buildSitePerformanceRecommendations({
      siteId: "11111111-1111-1111-1111-111111111111",
      domain: "example.com",
      serverId: "22222222-2222-2222-2222-222222222222",
      info: {
        collectedAt: new Date().toISOString(),
        sslEnabled: false,
        cacheBackend: "none",
        phpVersion: "7.4",
        isWordPress: true,
      },
    });
    const ids = report.recommendations.map((r) => r.id);
    expect(ids.some((id) => id.includes("ssl"))).toBe(true);
    expect(ids.some((id) => id.includes("cache"))).toBe(true);
    expect(ids.some((id) => id.includes("php"))).toBe(true);
  });

  it("flags high disk on server", () => {
    const report = buildServerPerformanceRecommendations({
      serverId: "22222222-2222-2222-2222-222222222222",
      serverName: "prod",
      host: "1.2.3.4",
      status: "healthy",
      health: { diskUsedPct: 96, collectedAt: new Date().toISOString() },
      healthAt: new Date().toISOString(),
      metricsAt: new Date().toISOString(),
      metrics: { netdataAvailable: true, gauges: [], collectedAt: new Date().toISOString() },
    });
    expect(report.recommendations.some((r) => r.id.includes("disk"))).toBe(true);
  });

  it("summarizes counts", () => {
    const sites = [
      buildSitePerformanceRecommendations({
        siteId: "11111111-1111-1111-1111-111111111111",
        domain: "a.com",
        serverId: "22222222-2222-2222-2222-222222222222",
        info: { collectedAt: new Date().toISOString(), sslEnabled: true, cacheBackend: "wpredis", phpVersion: "8.3" },
      }),
    ];
    const servers = [
      buildServerPerformanceRecommendations({
        serverId: "22222222-2222-2222-2222-222222222222",
        serverName: "prod",
        host: "1.2.3.4",
        status: "healthy",
        healthAt: new Date().toISOString(),
        metricsAt: new Date().toISOString(),
        metrics: { netdataAvailable: true, gauges: [], collectedAt: new Date().toISOString() },
      }),
    ];
    const summary = summarizePerformance(servers, sites);
    expect(summary.sites).toBe(1);
    expect(summary.servers).toBe(1);
  });
});

describe("playbooks", () => {
  it("exposes hardening cleanup audit", () => {
    expect(PLAYBOOKS.map((p) => p.id).sort()).toEqual(["audit", "cleanup", "hardening"]);
    expect(getPlaybookById("hardening")?.steps.length).toBeGreaterThan(1);
  });
});

describe("alerts schema", () => {
  it("requires webhook for slack", () => {
    const bad = alertChannelCreateSchema.safeParse({ name: "x", type: "slack" });
    expect(bad.success).toBe(false);
    const ok = alertChannelCreateSchema.safeParse({
      name: "x",
      type: "slack",
      webhookUrl: "https://hooks.slack.com/services/T/B/X",
    });
    expect(ok.success).toBe(true);
  });
});
