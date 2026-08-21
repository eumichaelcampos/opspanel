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

export type SecurityHubResponse = {
  summary: SecurityScore & { servers: number; sites: number };
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
  const raw = scored === 0 ? 50 : Math.round(((ok * 100 + warning * 55 + critical * 10) / scored));
  const score = Math.max(0, Math.min(100, raw - unknown * 2));
  const grade: SecurityScore["grade"] =
    score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
  return { score, grade, ok, warning, critical, unknown };
}
