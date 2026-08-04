import { describe, expect, it } from "vitest";
import { buildStackActionScript, parseHealthCollectOutput } from "./server-ops.js";

describe("buildStackActionScript", () => {
  it("builds fail2ban install", () => {
    const script = buildStackActionScript("install", ["fail2ban", "ngxblocker"], true);
    expect(script).toContain("wo stack install");
    expect(script).toContain("--fail2ban");
    expect(script).toContain("--ngxblocker");
  });
});

describe("parseHealthCollectOutput", () => {
  it("parses health kv block", () => {
    const out = `===OPS_HEALTH===
UPTIME_SECONDS=86400
LOAD1=0.5
LOAD5=0.4
LOAD15=0.3
CPU_COUNT=4
MEM_TOTAL_KB=8192000
MEM_AVAIL_KB=4096000
DISK_TOTAL_B=100000000000
DISK_USED_B=50000000000
===OPS_PROCESSES===
root 1 0.0 0.1 /sbin/init
===OPS_STACK===
nginx     :  Running
php8.2-fpm:  Running
fail2ban is not installed
Netdata is not installed`;
    const snap = parseHealthCollectOutput(out);
    expect(snap.uptimeSeconds).toBe(86400);
    expect(snap.memoryUsedPct).toBe(50);
    expect(snap.diskUsedPct).toBe(50);
    expect(snap.stackServices?.[0]?.name).toBe("nginx");
    expect(snap.stackComponents?.find((c) => c.id === "nginx")?.running).toBe(true);
    expect(snap.stackComponents?.find((c) => c.id === "php82")?.installed).toBe(true);
    expect(snap.stackComponents?.find((c) => c.id === "fail2ban")?.installed).toBe(false);
    expect(snap.stackComponents?.find((c) => c.id === "netdata")?.installed).toBe(false);
  });
});