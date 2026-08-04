export interface MetricsGauge {
  id: string;
  label: string;
  value: number | null;
  unit: string;
  formatted: string;
}

export interface MetricsStatusItem {
  label: string;
  alarm: string;
  status: "ok" | "warning" | "critical" | "unknown";
  value?: string;
}

export interface MetricsTimeSeries {
  chart: string;
  label: string;
  labels: string[];
  points: number[][];
}

export interface MetricsStubStatus {
  active?: number;
  reading?: number;
  writing?: number;
  waiting?: number;
  accepts?: number;
  handled?: number;
  requests?: number;
}

export type NetdataState = "available" | "service_running" | "installed" | "not_found";

export interface ServerMetricsSnapshot {
  netdataAvailable: boolean;
  netdataState?: NetdataState;
  interfaceName?: string;  gauges: MetricsGauge[];
  status: MetricsStatusItem[];
  series: MetricsTimeSeries[];
  stubStatus?: MetricsStubStatus;
  redisMemoryUsedMb?: number;
  mysqlThreads?: string;
  collectedAt: string;
  source: "netdata" | "fallback" | "mixed";
}
