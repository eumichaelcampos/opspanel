import type {
  MetricsGauge,
  MetricsStatusItem,
  MetricsStubStatus,
  MetricsTimeSeries,
  NetdataState,
  ServerMetricsSnapshot,
} from "./netdata-types.js";

export type { MetricsGauge, MetricsStatusItem, MetricsStubStatus, MetricsTimeSeries, ServerMetricsSnapshot };

const ND_BASE = "http://127.0.0.1:19999";

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

export function buildMetricsCollectScript(): string {
  const parts = [
    "export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH",
    `ND="${ND_BASE}"`,
    'fetch_nd() { curl -sf --max-time 4 "$1" 2>/dev/null || wget -qO- --timeout=4 "$1" 2>/dev/null || true; }',
    'echo "===OPS_NETDATA_AVAILABLE==="',
    'ND_STATE=no',
    'if fetch_nd "$ND/api/v1/info" | grep -q version; then ND_STATE=yes; fi',
    'if [ "$ND_STATE" = "no" ] && systemctl is-active --quiet netdata 2>/dev/null; then ND_STATE=service; fi',
    'if [ "$ND_STATE" = "no" ] && command -v netdata >/dev/null 2>&1; then ND_STATE=binary; fi',
    'echo "$ND_STATE"',    'echo "===OPS_NETDATA_GAUGE_system.cpu==="',
    'fetch_nd "$ND/api/v1/data?chart=system.cpu&after=-60&points=1&format=json&options=jsonwrap|nonzero"',
    'echo "===OPS_NETDATA_GAUGE_nginx_local.connections==="',
    'fetch_nd "$ND/api/v1/data?chart=nginx_local.connections&after=-60&points=1&format=json&options=jsonwrap|nonzero"',
    'echo "===OPS_NETDATA_GAUGE_nginx_local.requests==="',
    'fetch_nd "$ND/api/v1/data?chart=nginx_local.requests&after=-60&points=1&format=json&options=jsonwrap|nonzero"',
    'echo "===OPS_NETDATA_NET_CHART==="',
    'NET_CHART=""',
    'CHARTS_JSON=$(fetch_nd "$ND/api/v1/charts")',
    'if [ -n "$CHARTS_JSON" ]; then NET_CHART=$(echo "$CHARTS_JSON" | grep -oE "\\"net\\.[a-zA-Z0-9_.-]+\\"" | head -1 | tr -d "\\""); fi',
    'if [ -z "$NET_CHART" ]; then for IFACE in net.eth0 net.ens3 net.ens5 net.enp0s3 net.enp1s0 net.eno1 net.venet0; do if fetch_nd "$ND/api/v1/chart?chart=$IFACE" 2>/dev/null | grep -q dimension; then NET_CHART=$IFACE; break; fi; done; fi',
    'if [ -n "$NET_CHART" ]; then fetch_nd "$ND/api/v1/data?chart=$NET_CHART&after=-60&points=1&format=json&options=jsonwrap|nonzero"; echo "===OPS_NETDATA_IFACE_NAME===$NET_CHART"; fi',
    'echo "===OPS_PROC_NET_RATE==="',
    'DEF_IF=$(ip -4 route get 1.1.1.1 2>/dev/null | awk \'{for(i=1;i<=NF;i++) if($i=="dev") print $(i+1); exit}\')',
    'if [ -n "$DEF_IF" ] && [ -r /proc/net/dev ]; then R1=$(grep "$DEF_IF:" /proc/net/dev | awk \'{print $2,$10}\'); sleep 1; R2=$(grep "$DEF_IF:" /proc/net/dev | awk \'{print $2,$10}\'); echo "$DEF_IF $R1 $R2"; fi',
    'echo "===OPS_NETDATA_ALARMS==="',
    'fetch_nd "$ND/api/v1/alarms?all"',
    'echo "===OPS_NETDATA_SERIES_system.cpu==="',
    'fetch_nd "$ND/api/v1/data?chart=system.cpu&dimensions=user&after=-480&points=48&format=json&options=jsonwrap|nonzero"',
    'echo "===OPS_NETDATA_SERIES_system.ram==="',
    'fetch_nd "$ND/api/v1/data?chart=system.ram&after=-480&points=48&format=json&options=jsonwrap|nonzero"',
    'echo "===OPS_NETDATA_SERIES_nginx_local.connections==="',
    'fetch_nd "$ND/api/v1/data?chart=nginx_local.connections&after=-480&points=48&format=json&options=jsonwrap|nonzero"',
    'echo "===OPS_NETDATA_SERIES_nginx_local.requests==="',
    'fetch_nd "$ND/api/v1/data?chart=nginx_local.requests&after=-480&points=48&format=json&options=jsonwrap|nonzero"',
    'echo "===OPS_STUB_STATUS==="',
    "curl -sf --max-time 3 http://127.0.0.1/stub_status 2>/dev/null || curl -sf --max-time 3 http://127.0.0.1/nginx_status 2>/dev/null || true",
    'echo "===OPS_REDIS==="',
    "redis-cli INFO memory 2>/dev/null | grep used_memory_human || true",
    'echo "===OPS_MYSQL==="',
    "mysqladmin status 2>/dev/null || true",
  ];
  return parts.join("; ");
}

interface NetdataDataJson {
  labels?: string[];
  data?: number[][];
}

function parseNetdataSection(raw: string): NetdataDataJson | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "null") return null;
  try {
    const parsed = JSON.parse(trimmed) as { result?: NetdataDataJson } | NetdataDataJson;
    if ("result" in parsed && parsed.result) return parsed.result;
    return parsed as NetdataDataJson;
  } catch {
    return null;
  }
}

function lastRowSum(data: NetdataDataJson | null, skipFirst = 1): number | null {
  if (!data?.data?.length) return null;
  const row = data.data[data.data.length - 1];
  if (!row) return null;
  const values = row.slice(skipFirst).filter((v) => typeof v === "number" && Number.isFinite(v));
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0);
}

function lastRowValue(data: NetdataDataJson | null, dimIndex = 1): number | null {
  if (!data?.data?.length) return null;
  const row = data.data[data.data.length - 1];
  const val = row?.[dimIndex];
  return typeof val === "number" && Number.isFinite(val) ? val : null;
}

function findLabelIndex(labels: string[], name: string): number {
  const needle = name.toLowerCase();
  const idx = labels.findIndex((l) => {
    const lower = l.toLowerCase();
    return lower === needle || lower.includes(needle);
  });
  return idx;
}

function parseProcNetRate(text: string): { receivedKbps: number | null; sentKbps: number | null; iface?: string } {
  const line = text.trim().split("\n").find((l) => l.trim().length > 0);
  if (!line) return { receivedKbps: null, sentKbps: null };
  const parts = line.trim().split(/\s+/);
  if (parts.length < 5) return { receivedKbps: null, sentKbps: null };
  const iface = parts[0];
  const r1In = Number(parts[1]);
  const r1Out = Number(parts[2]);
  const r2In = Number(parts[3]);
  const r2Out = Number(parts[4]);
  if (![r1In, r1Out, r2In, r2Out].every((n) => Number.isFinite(n))) {
    return { receivedKbps: null, sentKbps: null, iface };
  }
  const inKbps = Math.max(0, ((r2In - r1In) * 8) / 1000);
  const outKbps = Math.max(0, ((r2Out - r1Out) * 8) / 1000);
  return { receivedKbps: inKbps, sentKbps: outKbps, iface };
}

function formatBytesPerSec(kbps: number, unit: "kbps" | "mbps"): string {
  if (unit === "mbps") return `${(kbps / 1024).toFixed(2)} mbps`;
  return `${kbps.toFixed(1)} kbps`;
}

function parseStubStatus(text: string): MetricsStubStatus | undefined {
  const active = text.match(/Active connections:\s*(\d+)/i)?.[1];
  const accepts = text.match(/(\d+)\s+(\d+)\s+(\d+)/);
  const reading = text.match(/Reading:\s*(\d+)/i)?.[1];
  const writing = text.match(/Writing:\s*(\d+)/i)?.[1];
  const waiting = text.match(/Waiting:\s*(\d+)/i)?.[1];
  if (!active && !accepts) return undefined;
  return {
    active: active ? Number(active) : undefined,
    reading: reading ? Number(reading) : undefined,
    writing: writing ? Number(writing) : undefined,
    waiting: waiting ? Number(waiting) : undefined,
    accepts: accepts?.[1] ? Number(accepts[1]) : undefined,
    handled: accepts?.[2] ? Number(accepts[2]) : undefined,
    requests: accepts?.[3] ? Number(accepts[3]) : undefined,
  };
}

function mapAlarmStatus(s?: string): MetricsStatusItem["status"] {
  if (!s) return "unknown";
  const u = s.toUpperCase();
  if (u === "CLEAR" || u === "OK") return "ok";
  if (u === "WARNING") return "warning";
  if (u === "CRITICAL") return "critical";
  return "unknown";
}

const STATUS_ALARMS = [
  { alarm: "10min_cpu_usage", label: "CPU" },
  { alarm: "load_average_15", label: "Load Average" },
  { alarm: "ram_in_use", label: "RAM in use" },
  { alarm: "ram_available", label: "RAM available" },
  { alarm: "disk_space_usage", label: "Disk Usage" },
  { alarm: "lowest_entropy", label: "System Entropy" },
] as const;

export function parseMetricsCollectOutput(output: string): ServerMetricsSnapshot {
  const text = stripAnsi(output);
  const sections = new Map<string, string>();
  let current = "_preamble";
  let buf: string[] = [];

  for (const line of text.split("\n")) {
    const m = line.match(/^===OPS_(.+?)===$/);
    if (m) {
      if (buf.length) sections.set(current, buf.join("\n"));
      current = m[1]!;
      buf = [];
      continue;
    }
    buf.push(line);
  }
  if (buf.length) sections.set(current, buf.join("\n"));

  const ndRaw = sections.get("NETDATA_AVAILABLE")?.trim() ?? "no";
  const netdataAvailable = ndRaw === "yes";
  const netdataState: NetdataState =
    ndRaw === "yes"
      ? "available"
      : ndRaw === "service"
        ? "service_running"
        : ndRaw === "binary"
          ? "installed"
          : "not_found";
  const ifaceFromNetdata = sections.get("NETDATA_IFACE_NAME")?.trim().replace(/^net\./, "");
  const procNet = parseProcNetRate(sections.get("PROC_NET_RATE") ?? "");
  const iface = ifaceFromNetdata || procNet.iface || undefined;

  const cpuData = parseNetdataSection(sections.get("NETDATA_GAUGE_system.cpu") ?? "");
  const nginxConn = parseNetdataSection(sections.get("NETDATA_GAUGE_nginx_local.connections") ?? "");
  const nginxReq = parseNetdataSection(sections.get("NETDATA_GAUGE_nginx_local.requests") ?? "");
  const netData = parseNetdataSection(sections.get("NETDATA_NET_CHART") ?? "");

  const cpuVal = lastRowSum(cpuData);
  const connVal = lastRowValue(nginxConn);
  const reqVal = lastRowValue(nginxReq);

  let netReceived: number | null = null;
  let netSent: number | null = null;
  if (netData?.labels && netData.data?.length) {
    const row = netData.data[netData.data.length - 1]!;
    const recvIdx = findLabelIndex(netData.labels, "received");
    const sentIdx = findLabelIndex(netData.labels, "sent");
    if (recvIdx >= 0) netReceived = typeof row[recvIdx] === "number" ? row[recvIdx]! : null;
    if (sentIdx >= 0) netSent = typeof row[sentIdx] === "number" ? row[sentIdx]! : null;
  }
  if (netReceived == null && procNet.receivedKbps != null) netReceived = procNet.receivedKbps;
  if (netSent == null && procNet.sentKbps != null) netSent = procNet.sentKbps;

  const gauges: MetricsGauge[] = [
    {
      id: "system.cpu",
      label: "CPU Usage",
      value: cpuVal,
      unit: "%",
      formatted: cpuVal != null ? `${cpuVal.toFixed(1)}%` : "—",
    },
    {
      id: "nginx_local.connections",
      label: "Nginx Connections",
      value: connVal,
      unit: "",
      formatted: connVal != null ? String(Math.round(connVal)) : "—",
    },
    {
      id: "nginx_local.requests",
      label: "Nginx Requests",
      value: reqVal,
      unit: "/s",
      formatted: reqVal != null ? `${reqVal.toFixed(1)}/s` : "—",
    },
    {
      id: "net.received",
      label: "Network IN",
      value: netReceived,
      unit: "kbps",
      formatted: netReceived != null ? formatBytesPerSec(netReceived, "kbps") : "—",
    },
    {
      id: "net.sent",
      label: "Network OUT",
      value: netSent,
      unit: "mbps",
      formatted: netSent != null ? formatBytesPerSec(netSent, "mbps") : "—",
    },
  ];

  const status: MetricsStatusItem[] = [];
  const alarmsRaw = sections.get("NETDATA_ALARMS")?.trim();
  if (alarmsRaw) {
    try {
      const alarmsJson = JSON.parse(alarmsRaw) as {
        alarms?: Record<string, { status?: string; value_string?: string }>;
      };
      for (const item of STATUS_ALARMS) {
        const a = alarmsJson.alarms?.[item.alarm];
        status.push({
          label: item.label,
          alarm: item.alarm,
          status: mapAlarmStatus(a?.status),
          value: a?.value_string,
        });
      }
    } catch {
      /* ignore parse errors */
    }
  }

  const series: MetricsTimeSeries[] = [];
  const seriesKeys = [
    { key: "NETDATA_SERIES_system.cpu", chart: "system.cpu", label: "Total CPU utilization" },
    { key: "NETDATA_SERIES_system.ram", chart: "system.ram", label: "System RAM" },
    { key: "NETDATA_SERIES_nginx_local.connections", chart: "nginx_local.connections", label: "Active Connections" },
    { key: "NETDATA_SERIES_nginx_local.requests", chart: "nginx_local.requests", label: "Requests" },
  ] as const;

  for (const sk of seriesKeys) {
    const parsed = parseNetdataSection(sections.get(sk.key) ?? "");
    if (parsed?.labels && parsed.data?.length) {
      series.push({
        chart: sk.chart,
        label: sk.label,
        labels: parsed.labels,
        points: parsed.data,
      });
    }
  }

  const stubStatus = parseStubStatus(sections.get("STUB_STATUS") ?? "");
  if (stubStatus?.active != null && connVal == null) {
    const g = gauges.find((x) => x.id === "nginx_local.connections");
    if (g) {
      g.value = stubStatus.active;
      g.formatted = String(stubStatus.active);
    }
  }

  const mysqlLine = sections.get("MYSQL")?.trim();

  return {
    netdataAvailable,
    netdataState,
    interfaceName: iface,
    gauges,
    status,
    series,
    stubStatus,
    mysqlThreads: mysqlLine || undefined,
    collectedAt: new Date().toISOString(),
    source: netdataAvailable ? (stubStatus ? "mixed" : "netdata") : "fallback",
  };
}

export function metricsCollectProbe(): readonly string[] {
  return ["bash", "-lc", buildMetricsCollectScript()];
}

export function wordopsDashboardUrl(host: string, path: string): string {
  return `https://${host}:22222${path}`;
}
