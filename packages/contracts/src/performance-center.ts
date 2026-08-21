/** Performance Advisor: recomendações a partir de inventário, saúde e métricas. */

export type PerformanceSeverity = "ok" | "info" | "warning" | "critical";

export type PerformanceApplyKind =
  | "site.manage"
  | "site.info"
  | "server.stack.action"
  | "server.metrics.collect"
  | "server.health.collect"
  | "none";

export type PerformanceRecommendation = {
  id: string;
  severity: PerformanceSeverity;
  title: string;
  detail: string;
  targetType: "site" | "server";
  targetId: string;
  targetLabel: string;
  /** Chave estável para Aplicar (ex.: cache_fastcgi, ssl_le, php_83). */
  actionKey?: string;
  apply?: {
    kind: PerformanceApplyKind;
    /** Para site.manage */
    siteManageAction?: string;
    /** Para server.stack.action */
    stackAction?: "install" | "restart" | "upgrade";
    stackComponents?: string[];
  };
  href?: string;
};

export type SitePerformanceReport = {
  siteId: string;
  domain: string;
  serverId: string;
  serverName?: string;
  phpVersion?: string | null;
  cacheBackend?: string | null;
  sslEnabled?: boolean;
  ttfbMs?: number | null;
  recommendations: PerformanceRecommendation[];
};

export type ServerPerformanceReport = {
  serverId: string;
  serverName: string;
  host: string;
  status: string;
  netdataAvailable?: boolean;
  cpuPct?: number | null;
  memPct?: number | null;
  diskPct?: number | null;
  lastMetricsAt?: string | null;
  lastHealthAt?: string | null;
  recommendations: PerformanceRecommendation[];
};

export type PerformanceAdvisorResponse = {
  summary: {
    sites: number;
    servers: number;
    critical: number;
    warning: number;
    info: number;
    okSites: number;
  };
  servers: ServerPerformanceReport[];
  sites: SitePerformanceReport[];
};

export type PerformanceApplyInput = {
  recommendationId: string;
  targetType: "site" | "server";
  targetId: string;
  actionKey: string;
  siteManageAction?: string;
  stackAction?: "install" | "restart" | "upgrade";
  stackComponents?: string[];
  applyKind: PerformanceApplyKind;
};

function isFresh(iso?: string | null, maxMs = 6 * 60 * 60 * 1000): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t < maxMs;
}

function phpSeverity(version?: string | null): PerformanceSeverity {
  if (!version) return "info";
  const major = Number(version.split(".")[0]);
  const minor = Number(version.split(".")[1] ?? "0");
  if (!Number.isFinite(major)) return "info";
  if (major < 8) return "critical";
  if (major === 8 && minor < 1) return "warning";
  if (major === 8 && minor < 2) return "info";
  return "ok";
}

function suggestedPhpAction(version?: string | null): string | undefined {
  if (!version) return "update_php83";
  const major = Number(version.split(".")[0]);
  const minor = Number(version.split(".")[1] ?? "0");
  if (!Number.isFinite(major) || major < 8 || (major === 8 && minor < 2)) return "update_php83";
  return undefined;
}

function gaugeValue(
  gauges: { id: string; value: number | null }[] | undefined,
  id: string,
): number | null {
  const g = gauges?.find((x) => x.id === id || x.id.startsWith(id));
  return g?.value ?? null;
}

export function buildSitePerformanceRecommendations(input: {
  siteId: string;
  domain: string;
  serverId: string;
  serverName?: string;
  info?: {
    phpVersion?: string;
    cacheBackend?: string;
    sslEnabled?: boolean;
    collectedAt?: string;
    isWordPress?: boolean;
  } | null;
  phpVersion?: string | null;
  cacheBackend?: string | null;
  ttfbMs?: number | null;
}): SitePerformanceReport {
  const info = input.info;
  const php = info?.phpVersion ?? input.phpVersion ?? null;
  const cache = (info?.cacheBackend ?? input.cacheBackend ?? "").toLowerCase();
  const ssl = info?.sslEnabled;
  const recs: PerformanceRecommendation[] = [];
  const base = {
    targetType: "site" as const,
    targetId: input.siteId,
    targetLabel: input.domain,
    href: `/sites/${input.siteId}?tab=manage`,
  };

  if (!info?.collectedAt) {
    recs.push({
      id: `${input.siteId}:needs_info`,
      severity: "warning",
      title: "Inventário desatualizado",
      detail: "Atualize as informações do site para recomendações precisas.",
      ...base,
      actionKey: "site_info",
      apply: { kind: "site.info" },
      href: `/sites/${input.siteId}`,
    });
  }

  if (ssl === false) {
    recs.push({
      id: `${input.siteId}:ssl`,
      severity: "critical",
      title: "SSL ausente",
      detail: "Ative Let's Encrypt para HTTPS.",
      ...base,
      actionKey: "ssl_le",
      apply: { kind: "site.manage", siteManageAction: "letsencrypt" },
    });
  } else if (ssl === true) {
    recs.push({
      id: `${input.siteId}:ssl_ok`,
      severity: "ok",
      title: "SSL ativo",
      detail: "HTTPS configurado.",
      ...base,
      apply: { kind: "none" },
    });
  }

  const hasCache =
    cache.includes("redis") ||
    cache.includes("fastcgi") ||
    cache.includes("wpfc") ||
    cache.includes("wpredis") ||
    cache.includes("rocket") ||
    cache.includes("wpsc") ||
    cache.includes("wpce");

  if (info?.isWordPress || cache || info) {
    if (!hasCache && cache !== "html" && cache !== "proxy") {
      recs.push({
        id: `${input.siteId}:cache`,
        severity: "warning",
        title: "Cache de página fraco ou ausente",
        detail: cache ? `Backend atual: ${cache}. Considere FastCGI ou Redis.` : "Nenhum cache de página detectado.",
        ...base,
        actionKey: "cache_wpfc",
        apply: { kind: "site.manage", siteManageAction: "update_wpfc" },
      });
    } else if (hasCache) {
      recs.push({
        id: `${input.siteId}:cache_ok`,
        severity: "ok",
        title: "Cache configurado",
        detail: cache || "Cache ativo",
        ...base,
        apply: { kind: "none" },
      });
    }
  }

  const phpSev = phpSeverity(php);
  if (phpSev !== "ok") {
    const action = suggestedPhpAction(php);
    recs.push({
      id: `${input.siteId}:php`,
      severity: phpSev === "info" ? "info" : phpSev,
      title: php ? `PHP ${php}` : "PHP não detectado",
      detail:
        phpSev === "critical"
          ? "Versão antiga. Atualize para 8.2+."
          : phpSev === "warning"
            ? "Considere atualizar para PHP 8.2 ou superior."
            : "Confirme a versão do PHP no inventário.",
      ...base,
      actionKey: action ? "php_upgrade" : undefined,
      apply: action ? { kind: "site.manage", siteManageAction: action } : { kind: "none" },
    });
  } else if (php) {
    recs.push({
      id: `${input.siteId}:php_ok`,
      severity: "ok",
      title: `PHP ${php}`,
      detail: "Versão suportada.",
      ...base,
      apply: { kind: "none" },
    });
  }

  if (input.ttfbMs != null) {
    const sev: PerformanceSeverity =
      input.ttfbMs > 1500 ? "warning" : input.ttfbMs > 800 ? "info" : "ok";
    recs.push({
      id: `${input.siteId}:ttfb`,
      severity: sev,
      title: `TTFB ~${input.ttfbMs} ms`,
      detail:
        sev === "ok"
          ? "Tempo de resposta inicial aceitável (HEAD)."
          : "TTFB elevado. Revise cache, PHP e origem.",
      ...base,
      apply: { kind: "none" },
      href: `/sites/${input.siteId}`,
    });
  }

  const actionable = recs.filter((r) => r.severity !== "ok");
  return {
    siteId: input.siteId,
    domain: input.domain,
    serverId: input.serverId,
    serverName: input.serverName,
    phpVersion: php,
    cacheBackend: info?.cacheBackend ?? input.cacheBackend ?? null,
    sslEnabled: ssl,
    ttfbMs: input.ttfbMs ?? null,
    recommendations: actionable.length ? actionable : recs.filter((r) => r.severity === "ok").slice(0, 3),
  };
}

export function buildServerPerformanceRecommendations(input: {
  serverId: string;
  serverName: string;
  host: string;
  status: string;
  health?: {
    memoryUsedPct?: number;
    diskUsedPct?: number;
    loadAvg?: [number, number, number];
    stackComponents?: { id: string; installed: boolean; running: boolean }[];
    collectedAt?: string;
  } | null;
  metrics?: {
    netdataAvailable?: boolean;
    gauges?: { id: string; value: number | null }[];
    status?: { label: string; status: string; value?: string; alarm?: string }[];
    collectedAt?: string;
  } | null;
  healthAt?: string | null;
  metricsAt?: string | null;
}): ServerPerformanceReport {
  const recs: PerformanceRecommendation[] = [];
  const base = {
    targetType: "server" as const,
    targetId: input.serverId,
    targetLabel: input.serverName,
    href: `/servers/${input.serverId}`,
  };

  const cpuPct = gaugeValue(input.metrics?.gauges, "system.cpu");
  const memFromMetrics = gaugeValue(input.metrics?.gauges, "system.ram");
  const memPct = input.health?.memoryUsedPct ?? memFromMetrics;
  const diskPct = input.health?.diskUsedPct ?? null;
  const netdata = input.metrics?.netdataAvailable;

  if (!isFresh(input.metricsAt)) {
    recs.push({
      id: `${input.serverId}:metrics_stale`,
      severity: "info",
      title: "Métricas desatualizadas",
      detail: input.metricsAt
        ? `Última coleta: ${new Date(input.metricsAt).toLocaleString("pt-BR")}`
        : "Nenhuma coleta Netdata/fallback ainda.",
      ...base,
      actionKey: "collect_metrics",
      apply: { kind: "server.metrics.collect" },
      href: `/servers/${input.serverId}?tab=monitoring`,
    });
  }

  if (!isFresh(input.healthAt)) {
    recs.push({
      id: `${input.serverId}:health_stale`,
      severity: "warning",
      title: "Saúde desatualizada",
      detail: "Colete a saúde para disco, memória e stack.",
      ...base,
      actionKey: "collect_health",
      apply: { kind: "server.health.collect" },
    });
  }

  if (netdata === false) {
    recs.push({
      id: `${input.serverId}:netdata`,
      severity: "warning",
      title: "Netdata indisponível",
      detail: "Instale Netdata no stack para métricas em tempo real.",
      ...base,
      actionKey: "install_netdata",
      apply: {
        kind: "server.stack.action",
        stackAction: "install",
        stackComponents: ["netdata"],
      },
      href: `/servers/${input.serverId}?tab=stack`,
    });
  }

  const redis = input.health?.stackComponents?.find((c) => c.id === "redis");
  if (redis && !redis.running) {
    recs.push({
      id: `${input.serverId}:redis`,
      severity: "warning",
      title: "Redis parado",
      detail: redis.installed ? "Redis instalado, mas não está em execução." : "Redis não instalado.",
      ...base,
      actionKey: "restart_redis",
      apply: {
        kind: "server.stack.action",
        stackAction: redis.installed ? "restart" : "install",
        stackComponents: ["redis"],
      },
      href: `/servers/${input.serverId}?tab=stack`,
    });
  }

  if (cpuPct != null && cpuPct >= 85) {
    recs.push({
      id: `${input.serverId}:cpu`,
      severity: cpuPct >= 95 ? "critical" : "warning",
      title: `CPU alta (${Math.round(cpuPct)}%)`,
      detail: "Verifique processos e cache dos sites.",
      ...base,
      apply: { kind: "none" },
      href: `/servers/${input.serverId}?tab=monitoring`,
    });
  }

  if (memPct != null && memPct >= 85) {
    recs.push({
      id: `${input.serverId}:mem`,
      severity: memPct >= 95 ? "critical" : "warning",
      title: `Memória alta (${Math.round(memPct)}%)`,
      detail: "Considere reiniciar Redis/PHP-FPM ou ampliar o servidor.",
      ...base,
      apply: { kind: "none" },
      href: `/servers/${input.serverId}?tab=monitoring`,
    });
  }

  if (diskPct != null && diskPct >= 85) {
    recs.push({
      id: `${input.serverId}:disk`,
      severity: diskPct >= 95 ? "critical" : "warning",
      title: `Disco alto (${Math.round(diskPct)}%)`,
      detail: "Rode o playbook de limpeza ou remova backups antigos.",
      ...base,
      apply: { kind: "none" },
      href: `/automation`,
    });
  }

  for (const st of input.metrics?.status ?? []) {
    if (st.status === "critical" || st.status === "warning") {
      recs.push({
        id: `${input.serverId}:alarm:${st.alarm ?? st.label}`,
        severity: st.status === "critical" ? "critical" : "warning",
        title: `Alarme Netdata: ${st.label}`,
        detail: st.value ? `Valor: ${st.value}` : `Status ${st.status}`,
        ...base,
        apply: { kind: "none" },
        href: `/servers/${input.serverId}?tab=monitoring`,
      });
    }
  }

  if (input.status === "offline" || input.status === "critical") {
    recs.push({
      id: `${input.serverId}:status`,
      severity: "critical",
      title: `Servidor ${input.status}`,
      detail: "Verifique conectividade SSH e saúde.",
      ...base,
      apply: { kind: "none" },
    });
  }

  return {
    serverId: input.serverId,
    serverName: input.serverName,
    host: input.host,
    status: input.status,
    netdataAvailable: netdata,
    cpuPct,
    memPct: memPct ?? null,
    diskPct,
    lastMetricsAt: input.metricsAt ?? null,
    lastHealthAt: input.healthAt ?? null,
    recommendations: recs,
  };
}

export function summarizePerformance(
  servers: ServerPerformanceReport[],
  sites: SitePerformanceReport[],
): PerformanceAdvisorResponse["summary"] {
  let critical = 0;
  let warning = 0;
  let info = 0;
  let okSites = 0;
  for (const s of servers) {
    for (const r of s.recommendations) {
      if (r.severity === "critical") critical += 1;
      else if (r.severity === "warning") warning += 1;
      else if (r.severity === "info") info += 1;
    }
  }
  for (const s of sites) {
    const actionable = s.recommendations.filter((r) => r.severity !== "ok");
    if (!actionable.length) okSites += 1;
    for (const r of actionable) {
      if (r.severity === "critical") critical += 1;
      else if (r.severity === "warning") warning += 1;
      else if (r.severity === "info") info += 1;
    }
  }
  return {
    sites: sites.length,
    servers: servers.length,
    critical,
    warning,
    info,
    okSites,
  };
}
