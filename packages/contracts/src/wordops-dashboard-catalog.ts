/** Mapeado de https://github.com/WordOps/wordops-dashboard index.html */

export const WORDOPS_NETDATA_GAUGES = [
  { id: "system.cpu", label: "CPU", unit: "%", color: "orange" },
  { id: "nginx_local.connections", label: "Nginx Connections", unit: "", color: "blue" },
  { id: "nginx_local.requests", label: "Nginx Requests", unit: "/s", color: "green" },
  { id: "net.received", label: "Network IN", unit: "kbps", color: "blue", netDimension: "received" },
  { id: "net.sent", label: "Network OUT", unit: "mbps", color: "red", netDimension: "sent" },
] as const;

export const WORDOPS_NETDATA_CHARTS = [
  { id: "system.cpu", label: "Total CPU utilization", dimension: "user" },
  { id: "system.ram", label: "System RAM" },
  { id: "nginx_local.connections", label: "Active Connections" },
  { id: "nginx_local.requests", label: "Requests" },
] as const;

/** Alarmes exibidos na coluna Status do dashboard WordOps */
export const WORDOPS_NETDATA_STATUS_ALARMS = [
  { alarm: "10min_cpu_usage", chart: "system.cpu", label: "CPU" },
  { alarm: "load_average_15", chart: "system.load", label: "Load Average" },
  { alarm: "ram_in_use", chart: "system.ram", label: "RAM in use" },
  { alarm: "ram_available", chart: "mem.available", label: "RAM available" },
  { alarm: "disk_space_usage", chart: "disk_space._", label: "Disk Usage" },
  { alarm: "lowest_entropy", chart: "system.entropy", label: "System Entropy" },
] as const;

/** Ferramentas do backend WordOps (:22222) */
export const WORDOPS_DASHBOARD_TOOLS = {
  monitoring: [
    { id: "netdata", label: "Netdata", path: "/netdata/", desc: "Monitoramento completo" },
    { id: "vts", label: "Nginx VTS", path: "/vts_status", desc: "Tráfego por vhost" },
    { id: "files", label: "File Manager", path: "/files/", desc: "eXtplorer" },
    { id: "phpinfo", label: "PHP Info", path: "/php/info.php", desc: "phpinfo()" },
  ],
  database: [
    { id: "pma", label: "phpMyAdmin", path: "/db/pma/", desc: "Interface web MySQL" },
    { id: "adminer", label: "Adminer", path: "/db/adminer/", desc: "Alternativa leve ao phpMyAdmin" },
  ],
  cache: [
    { id: "redis", label: "Redis", path: "/cache/redis/phpRedisAdmin/", desc: "phpRedisAdmin" },
    { id: "opcache", label: "Opcache", path: "/cache/opcache/opgui.php", desc: "Opcache GUI" },
  ],
  php: [
    { id: "fpm80", label: "PHP-FPM 8.0", path: "/fpm/status/php80", desc: "Status pool FPM" },
    { id: "fpm81", label: "PHP-FPM 8.1", path: "/fpm/status/php81", desc: "Status pool FPM" },
    { id: "fpm82", label: "PHP-FPM 8.2", path: "/fpm/status/php82", desc: "Status pool FPM" },
    { id: "fpm83", label: "PHP-FPM 8.3", path: "/fpm/status/php83", desc: "Status pool FPM" },
  ],
} as const;

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

export interface ServerMetricsSnapshot {
  netdataAvailable: boolean;
  interfaceName?: string;
  gauges: MetricsGauge[];
  status: MetricsStatusItem[];
  series: MetricsTimeSeries[];
  stubStatus?: MetricsStubStatus;
  redisMemoryUsedMb?: number;
  mysqlThreads?: string;
  collectedAt: string;
  source: "netdata" | "fallback" | "mixed";
}
