/** Security Center: checklist agregado por servidor e site. */

export type SecuritySeverity = "ok" | "warning" | "critical" | "unknown";

export type SecurityCheckId =
  | "fail2ban"
  | "ufw"
  | "ngxblocker"
  | "ssh_port"
  | "listening_ports"
  | "root_login"
  | "ssl"
  | "hsts"
  | "site_enabled"
  | "php_supported"
  | "health_fresh";

export type SecurityCheck = {
  id: SecurityCheckId | string;
  label: string;
  severity: SecuritySeverity;
  detail?: string;
  /** Ação sugerida na UI */
  actionHint?: string;
  href?: string;
};

export type SecurityScore = {
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  ok: number;
  warning: number;
  critical: number;
  unknown: number;
};

export type ServerSecurityReport = {
  serverId: string;
  serverName: string;
  host: string;
  status: string;
  score: SecurityScore;
  checks: SecurityCheck[];
  components: {
    fail2ban?: { installed: boolean; running: boolean };
    ufw?: { installed: boolean; running: boolean; active?: boolean; openPorts?: number[] };
    ngxblocker?: { installed: boolean; running: boolean };
  };
  lastHealthAt?: string | null;
  lastSecurityScanAt?: string | null;
  securitySnapshot?: SecurityScanSnapshot | null;
};

export type SiteSecurityReport = {
  siteId: string;
  domain: string;
  serverId: string;
  serverName?: string;
  score: SecurityScore;
  checks: SecurityCheck[];
  isWordPress?: boolean;
};

export type SecurityAlertItem = {
  id: string;
  severity: Exclude<SecuritySeverity, "ok" | "unknown"> | "unknown";
  scope: "server" | "site";
  title: string;
  detail?: string;
  targetLabel: string;
  href?: string;
  actionHint?: string;
  checkId: string;
};

export type SecurityHubResponse = {
  summary: SecurityScore & { servers: number; sites: number };
  /** Alertas abertos (crítico + aviso), prontos para listar na UI. */
  openAlerts: SecurityAlertItem[];
  servers: ServerSecurityReport[];
  sitesAtRisk: SiteSecurityReport[];
};

export type SecurityScanSnapshot = {
  collectedAt: string;
  ufwActive?: boolean;
  ufwDefaultIncoming?: string;
  ufwOpenPorts?: number[];
  fail2banJails?: string[];
  fail2banBannedTotal?: number;
  listeningTcpPorts?: number[];
  permitRootLogin?: string;
  passwordAuthentication?: string;
  lynisInstalled?: boolean;
  lynisHardeningIndex?: number | null;
  lynisWarnings?: number;
  lynisSuggestions?: number;
  clamavInstalled?: boolean;
  clamavFresh?: boolean;
  clamavLastScanAt?: string | null;
  chkrootkitInstalled?: boolean;
  rkhunterInstalled?: boolean;
  crowdsecInstalled?: boolean;
  crowdsecRunning?: boolean;
  unattendedUpgradesEnabled?: boolean;
  aideInstalled?: boolean;
  aideDbExists?: boolean;
  notes?: string[];
};

export function computeSecurityScore(checks: SecurityCheck[]): SecurityScore {
  let ok = 0;
  let warning = 0;
  let critical = 0;
  let unknown = 0;
  for (const c of checks) {
    if (c.severity === "ok") ok += 1;
    else if (c.severity === "warning") warning += 1;
    else if (c.severity === "critical") critical += 1;
    else unknown += 1;
  }
  const scored = ok + warning + critical;
  const raw = scored === 0 ? 50 : Math.round((ok * 100 + warning * 55 + critical * 10) / scored);
  const score = Math.max(0, Math.min(100, raw - unknown * 2));
  const grade: SecurityScore["grade"] =
    score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
  return { score, grade, ok, warning, critical, unknown };
}

export function collectOpenAlerts(input: {
  servers: ServerSecurityReport[];
  sites: SiteSecurityReport[];
}): SecurityAlertItem[] {
  const alerts: SecurityAlertItem[] = [];
  for (const s of input.servers) {
    for (const c of s.checks) {
      if (c.severity !== "warning" && c.severity !== "critical" && c.severity !== "unknown") continue;
      alerts.push({
        id: `server:${s.serverId}:${c.id}`,
        severity: c.severity === "unknown" ? "unknown" : c.severity,
        scope: "server",
        title: c.label,
        detail: c.detail,
        targetLabel: s.serverName,
        href: c.href ?? `/servers/${s.serverId}`,
        actionHint: c.actionHint,
        checkId: c.id,
      });
    }
  }
  for (const site of input.sites) {
    for (const c of site.checks) {
      if (c.severity !== "warning" && c.severity !== "critical" && c.severity !== "unknown") continue;
      alerts.push({
        id: `site:${site.siteId}:${c.id}`,
        severity: c.severity === "unknown" ? "unknown" : c.severity,
        scope: "site",
        title: c.label,
        detail: c.detail,
        targetLabel: site.domain,
        href: c.href ?? `/sites/${site.siteId}`,
        actionHint: c.actionHint,
        checkId: c.id,
      });
    }
  }
  const rank = (s: SecurityAlertItem["severity"]) => (s === "critical" ? 0 : s === "warning" ? 1 : 2);
  return alerts.sort((a, b) => rank(a.severity) - rank(b.severity) || a.targetLabel.localeCompare(b.targetLabel));
}
