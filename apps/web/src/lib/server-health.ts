"use client";

export type StackComponentState = {
  id: string;
  installed: boolean;
  running: boolean;
  status: string;
  serviceName?: string;
};

export type HealthSnapshot = {
  uptimeSeconds?: number;
  loadAvg?: [number, number, number];
  memoryTotalMb?: number;
  memoryUsedMb?: number;
  memoryUsedPct?: number;
  diskTotalGb?: number;
  diskUsedGb?: number;
  diskUsedPct?: number;
  cpuCount?: number;
  topProcesses?: { pid: string; cpu: string; mem: string; command: string }[];
  stackServices?: { name: string; status: string }[];
  stackComponents?: StackComponentState[];
  rawStackStatus?: string;
  collectedAt?: string;
};
export function formatUptime(seconds?: number): string {
  if (seconds == null) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function healthLevel(pct?: number): "ok" | "warn" | "critical" {
  if (pct == null) return "ok";
  if (pct >= 90) return "critical";
  if (pct >= 75) return "warn";
  return "ok";
}
