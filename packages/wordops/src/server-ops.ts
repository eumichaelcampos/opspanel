export interface StackComponentState {
  id: string;
  installed: boolean;
  running: boolean;
  status: string;
  serviceName?: string;
}

export interface ParsedHealthSnapshot {
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
  wordopsVersion?: string;
  collectedAt?: string;
}
const WO_PATH =
  "export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH";

function woCmd(subcommand: string): string {
  return `(command -v wo >/dev/null && wo ${subcommand}) || (/usr/local/bin/wo ${subcommand})`;
}

function woVersionCmd(): string {
  return `(command -v wo >/dev/null && (wo --version 2>/dev/null | head -1)) || (/usr/local/bin/wo --version 2>/dev/null | head -1 || true)`;
}

function woStackStatusCmd(): string {
  // --all pode retornar vazio com exit 0 em algumas versões; sempre incluir stack status padrão.
  return `{ out=$(${woCmd("stack status --all")} 2>&1); if [ -n "$out" ]; then echo "$out"; else ${woCmd("stack status")} 2>&1; fi; }`;
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

const STACK_COMPONENT_FLAGS: Record<string, string> = {
  all: "--all",
  web: "--web",
  admin: "--admin",
  utils: "--utils",
  nginx: "--nginx",
  php: "--php",
  php74: "--php74",
  php80: "--php80",
  php81: "--php81",
  php82: "--php82",
  php83: "--php83",
  mysql: "--mysql",
  redis: "--redis",
  wpcli: "--wpcli",
  phpmyadmin: "--phpmyadmin",
  composer: "--composer",
  netdata: "--netdata",
  dashboard: "--dashboard",
  adminer: "--adminer",
  fail2ban: "--fail2ban",
  proftpd: "--proftpd",
  ngxblocker: "--ngxblocker",
  ufw: "--ufw",
  brotli: "--brotli",
  sendmail: "--sendmail",
  mysqltuner: "--mysqltuner",
};

export type StackActionKind =
  | "install"
  | "remove"
  | "purge"
  | "upgrade"
  | "restart"
  | "reload"
  | "start"
  | "stop"
  | "status";

export function buildStackActionScript(
  action: StackActionKind,
  components: string[],
  force?: boolean,
): string {
  const flags = components
    .map((c) => STACK_COMPONENT_FLAGS[c])
    .filter(Boolean)
    .join(" ");
  const forceFlag = force ? " --force" : "";
  const needsForce = ["install", "remove", "purge", "upgrade"].includes(action);
  const autoForce = needsForce && !forceFlag ? " --force" : "";
  return `${WO_PATH}; ${woCmd(`stack ${action} ${flags}${forceFlag}${autoForce}`)}`;
}

export function buildMaintenanceScript(): string {
  return `${WO_PATH}; ${woCmd("maintenance")}`;
}

/** Atualização APT nativa (antes do WordOps estar instalado). Fluxo do artigo Michael Campos. */
export function buildSystemUpdateScript(): string {
  return [
    "export DEBIAN_FRONTEND=noninteractive",
    "export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH",
    "apt-get update -y",
    'apt-get upgrade -y -o Dpkg::Options::="--force-confold"',
    'echo "OPS_SYSTEM_UPDATE_OK=1"',
  ].join("; ");
}

export function buildHealthCollectScript(): string {
  const script = [
    WO_PATH,
    'echo "===OPS_HEALTH==="',
    'awk \'{print "UPTIME_SECONDS=" int($1)}\' /proc/uptime',
    'read l1 l2 l3 _ < /proc/loadavg; echo "LOAD1=$l1"; echo "LOAD5=$l2"; echo "LOAD15=$l3"',
    'echo "CPU_COUNT=$(nproc 2>/dev/null || echo 1)"',
    'mt=$(grep MemTotal /proc/meminfo | awk \'{print $2}\'); echo "MEM_TOTAL_KB=$mt"',
    'ma=$(grep MemAvailable /proc/meminfo | awk \'{print $2}\'); echo "MEM_AVAIL_KB=$ma"',
    'df -B1 / 2>/dev/null | tail -1 | awk \'{print "DISK_TOTAL_B="$2; print "DISK_USED_B="$3}\'',
    `v=$(${woVersionCmd()}); echo "WORDOPS_VERSION=$v"`,
    'echo "===OPS_PROCESSES==="',
    "ps aux --sort=-%cpu 2>/dev/null | head -6 | tail -5",
    'echo "===OPS_STACK==="',
    woStackStatusCmd(),
  ].join("; ");
  return script;
}

const STACK_NAME_TO_ID: Record<string, string> = {
  nginx: "nginx",
  mariadb: "mysql",
  mysql: "mysql",
  redis: "redis",
  "redis-server": "redis",
  netdata: "netdata",
  fail2ban: "fail2ban",
  proftpd: "proftpd",
  composer: "composer",
  phpmyadmin: "phpmyadmin",
  adminer: "adminer",
  brotli: "brotli",
  sendmail: "sendmail",
  mysqltuner: "mysqltuner",
  wpcli: "wpcli",
  "wp-cli": "wpcli",
  ngxblocker: "ngxblocker",
  "nginx bad bot blocker": "ngxblocker",
  dashboard: "dashboard",
  "wordops dashboard": "dashboard",
};

function normalizeStackName(name: string): string {
  return name.trim().toLowerCase();
}

function phpVersionToComponentId(version: string): string {
  return `php${version.replace(".", "")}`;
}

function phpFpmServiceToId(service: string): string | undefined {
  const match = service.match(/php([\d.]+)-fpm/i);
  if (!match?.[1]) return undefined;
  return phpVersionToComponentId(match[1]);
}

function upsertStackComponent(
  map: Map<string, StackComponentState>,
  id: string,
  partial: Omit<StackComponentState, "id">,
): void {
  const prev = map.get(id);
  map.set(id, {
    id,
    installed: partial.installed || prev?.installed || false,
    running: partial.running || prev?.running || false,
    status: partial.status || prev?.status || "unknown",
    serviceName: partial.serviceName ?? prev?.serviceName,
  });
}

export function parseStackStatusOutput(raw: string): StackComponentState[] {
  const text = stripAnsi(raw);
  const byId = new Map<string, StackComponentState>();

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("===")) continue;

    const phpSvc = line.match(/^(php[\d.]+-fpm)\s*:\s*(Running|Stopped|Dead|Failed|Inactive|Not running)/i);
    if (phpSvc) {
      const phpId = phpFpmServiceToId(phpSvc[1]!);
      if (phpId) {
        const status = phpSvc[2]!.toLowerCase();
        upsertStackComponent(byId, phpId, {
          installed: true,
          running: status === "running",
          status,
          serviceName: phpSvc[1],
        });
      }
      continue;
    }

    const svc = line.match(/^([a-zA-Z0-9@._-]+)\s*:\s*(Running|Stopped|Dead|Failed|Inactive|Not running)/i);
    if (svc) {
      const name = normalizeStackName(svc[1]!);
      const id = STACK_NAME_TO_ID[name] ?? name;
      const status = svc[2]!.toLowerCase();
      upsertStackComponent(byId, id, {
        installed: true,
        running: status === "running",
        status,
        serviceName: svc[1],
      });
      continue;
    }

    const phpNot = line.match(/^PHP\s+([\d.]+)\s+is not installed/i);
    if (phpNot) {
      upsertStackComponent(byId, phpVersionToComponentId(phpNot[1]!), {
        installed: false,
        running: false,
        status: "not_installed",
      });
      continue;
    }

    const notInstalled = line.match(/^(.+?)\s+is not installed/i);
    if (notInstalled) {
      const name = normalizeStackName(notInstalled[1]!);
      const id = STACK_NAME_TO_ID[name] ?? name.replace(/\s+/g, "");
      upsertStackComponent(byId, id, {
        installed: false,
        running: false,
        status: "not_installed",
      });
      continue;
    }

    const ufw = line.match(/^UFW Firewall is (disabled|enabled|active|running|inactive)/i);
    if (ufw) {
      const status = ufw[1]!.toLowerCase();
      upsertStackComponent(byId, "ufw", {
        installed: status !== "disabled",
        running: status === "active" || status === "running" || status === "enabled",
        status,
      });
      continue;
    }

    if (/dashboard/i.test(line) && /running|active|installed|enabled/i.test(line)) {
      upsertStackComponent(byId, "dashboard", {
        installed: true,
        running: /running|active|enabled/i.test(line),
        status: line,
      });
    }
  }

  return Array.from(byId.values());
}
function parseNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function parseHealthCollectOutput(output: string): ParsedHealthSnapshot {
  const text = stripAnsi(output);
  const snapshot: ParsedHealthSnapshot = { collectedAt: new Date().toISOString() };
  const kv: Record<string, string> = {};

  let section = "health";
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "===OPS_HEALTH===") {
      section = "health";
      continue;
    }
    if (line === "===OPS_PROCESSES===") {
      section = "processes";
      snapshot.topProcesses = snapshot.topProcesses ?? [];
      continue;
    }
    if (line === "===OPS_STACK===") {
      section = "stack";
      continue;
    }

    if (section === "health") {
      const m = line.match(/^([A-Z0-9_]+)=(.+)$/);
      if (m) kv[m[1]!] = m[2]!.trim();
      continue;
    }

    if (section === "processes" && line && !line.startsWith("USER")) {
      const parts = line.split(/\s+/);
      if (parts.length >= 11) {
        snapshot.topProcesses!.push({
          pid: parts[1]!,
          cpu: parts[2]!,
          mem: parts[3]!,
          command: parts.slice(10).join(" "),
        });
      }
      continue;
    }

    if (section === "stack" && line) {
      snapshot.rawStackStatus = (snapshot.rawStackStatus ?? "") + line + "\n";
      const svc = line.match(
        /^([A-Za-z0-9@._-]+)\s*[:.]?\s*(running|active|inactive|dead|failed|stopped|enabled|disabled)/i,
      );
      if (svc) {
        snapshot.stackServices = snapshot.stackServices ?? [];
        snapshot.stackServices.push({ name: svc[1]!, status: svc[2]!.toLowerCase() });
      }
    }
  }

  if (snapshot.rawStackStatus) {
    snapshot.stackComponents = parseStackStatusOutput(snapshot.rawStackStatus);
  }

  snapshot.uptimeSeconds = parseNumber(kv.UPTIME_SECONDS);
  const l1 = parseNumber(kv.LOAD1);
  const l5 = parseNumber(kv.LOAD5);
  const l15 = parseNumber(kv.LOAD15);
  if (l1 != null && l5 != null && l15 != null) snapshot.loadAvg = [l1, l5, l15];

  const memTotalKb = parseNumber(kv.MEM_TOTAL_KB);
  const memAvailKb = parseNumber(kv.MEM_AVAIL_KB);
  if (memTotalKb != null) {
    snapshot.memoryTotalMb = Math.round(memTotalKb / 1024);
    if (memAvailKb != null) {
      snapshot.memoryUsedMb = Math.round((memTotalKb - memAvailKb) / 1024);
      snapshot.memoryUsedPct = Math.round(((memTotalKb - memAvailKb) / memTotalKb) * 100);
    }
  }

  const diskTotalB = parseNumber(kv.DISK_TOTAL_B);
  const diskUsedB = parseNumber(kv.DISK_USED_B);
  if (diskTotalB != null) {
    snapshot.diskTotalGb = Math.round((diskTotalB / 1024 ** 3) * 10) / 10;
    if (diskUsedB != null) {
      snapshot.diskUsedGb = Math.round((diskUsedB / 1024 ** 3) * 10) / 10;
      snapshot.diskUsedPct = Math.round((diskUsedB / diskTotalB) * 100);
    }
  }

  snapshot.cpuCount = parseNumber(kv.CPU_COUNT);
  if (kv.WORDOPS_VERSION) snapshot.wordopsVersion = kv.WORDOPS_VERSION.replace(/^WordOps\s+/i, "").trim() || undefined;
  return snapshot;
}

export function buildUfwAllowPortsScript(ports: number[] = [22, 80, 443, 22222]): string {
  const uniquePorts = [...new Set(ports)];
  const allowRules = uniquePorts.map((p) => `ufw allow ${p}/tcp`).join("; ");
  return [
    WO_PATH,
    "command -v ufw >/dev/null || (apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y ufw)",
    "ufw allow OpenSSH || true",
    allowRules,
    "ufw --force enable || true",
    "ufw status verbose || ufw status || true",
  ].join("; ");
}

export function buildUfwConfigureScript(ports: number[] = [22, 80, 443, 22222]): string {
  const allowScript = buildUfwAllowPortsScript(ports).replace(`${WO_PATH}; `, "");
  return [`${WO_PATH}; ${woCmd("stack install --ufw --force")}`, allowScript].join("; ");
}

export function buildWordOpsInstallScript(adminEmail?: string): string {
  const emailFlag = adminEmail ? ` --email ${shellQuoteEmail(adminEmail)}` : "";
  return [
    "export DEBIAN_FRONTEND=noninteractive",
    "cd /tmp",
    "wget -qO wo wops.cc || curl -fsSL -o wo wops.cc",
    `bash wo install --force${emailFlag} 2>&1 || bash wo --force 2>&1`,
    `${WO_PATH}; ${woVersionCmd()}`,
    'echo "OPS_WORDOPS_INSTALL_DONE=1"',
  ].join("; ");
}

export function buildWordOpsVerifyScript(): string {
  return [
    WO_PATH,
    woVersionCmd(),
    'echo "OPS_WORDOPS_VERIFY_DONE=1"',
  ].join("; ");
}

export interface ParsedWordOpsDashboard {
  url?: string;
  username?: string;
  password?: string;
  capturedAt: string;
}

/** Credenciais exibidas após wo stack install (HTTP Auth + URL :22222). */
export function parseWordOpsDashboardCredentials(output: string): ParsedWordOpsDashboard | null {
  const text = stripAnsi(output);
  const username = text.match(/HTTP Auth User Name:\s*(.+)/i)?.[1]?.trim();
  const password = text.match(/HTTP Auth Password\s*:\s*(.+)/i)?.[1]?.trim();
  const url =
    text.match(/WordOps backend is available on (https?:\/\/[^\s]+)/i)?.[1]?.trim() ??
    text.match(/(https?:\/\/[\d.a-z-]+:22222)/i)?.[1]?.trim();

  if (!username && !password && !url) return null;

  return {
    url,
    username,
    password,
    capturedAt: new Date().toISOString(),
  };
}

export type WordOpsDashboardRecoverMode = "reset" | "capture";

export interface WordOpsDashboardRecoverOptions {
  host: string;
  mode?: WordOpsDashboardRecoverMode;
  username?: string;
  password?: string;
}

/**
 * Recuperação do backend WordOps (:22222).
 * - reset: wo secure --auth (https://docs.wordops.net/commands/secure/)
 * - capture: wo stack install --dashboard e parse da saída
 */
export function buildWordOpsDashboardRecoverScript(options: WordOpsDashboardRecoverOptions): string {
  const mode = options.mode ?? "reset";
  const host = shellQuote(options.host);
  const userLiteral = options.username ? shellQuote(options.username) : "admin";

  if (mode === "capture") {
    return [
      WO_PATH,
      `${woCmd("stack install --dashboard --force")}`,
      `echo "WordOps backend is available on https://${options.host}:22222"`,
      'echo "OPS_DASHBOARD_RECOVER_DONE=1"',
    ].join("; ");
  }

  const credSetup = options.password
    ? `OPS_USER=${userLiteral}; OPS_PASS=${shellQuote(options.password)}`
    : `OPS_USER=${userLiteral}; OPS_PASS=$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 20)`;

  const secureCmd = options.password
    ? `${woCmd(`secure --auth ${userLiteral} ${shellQuote(options.password)}`)}`
    : `${woCmd('secure --auth "$OPS_USER" "$OPS_PASS"')}`;

  return [
    WO_PATH,
    credSetup,
    `${woCmd("stack install --dashboard --force")} || true`,
    secureCmd,
    'echo "HTTP Auth User Name: $OPS_USER"',
    'echo "HTTP Auth Password : $OPS_PASS"',
    `echo "WordOps backend is available on https://${options.host}:22222"`,
    'echo "OPS_DASHBOARD_RECOVER_DONE=1"',
  ].join("; ");
}

export function wordOpsDashboardRecoverProbe(options: WordOpsDashboardRecoverOptions): readonly string[] {
  return ["bash", "-lc", buildWordOpsDashboardRecoverScript(options)];
}

export function wordOpsVerifyProbe(): readonly string[] {
  return ["bash", "-lc", buildWordOpsVerifyScript()];
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function shellQuoteEmail(email: string): string {
  return `'${email.replace(/'/g, `'\"'\"'`)}'`;
}

export function buildStackMigrateScript(target: "mariadb" = "mariadb"): string {
  const flag = target === "mariadb" ? "--mariadb" : "";
  return `${WO_PATH}; ${woCmd(`stack migrate ${flag} --force`)}`;
}

export function wordOpsInstallProbe(adminEmail?: string): readonly string[] {
  return ["bash", "-lc", buildWordOpsInstallScript(adminEmail)];
}

export function stackMigrateProbe(target: "mariadb" = "mariadb"): readonly string[] {
  return ["bash", "-lc", buildStackMigrateScript(target)];
}

export function ufwConfigureProbe(ports?: number[]): readonly string[] {
  return ["bash", "-lc", buildUfwConfigureScript(ports)];
}

export function ufwAllowPortsProbe(ports?: number[]): readonly string[] {
  return ["bash", "-lc", buildUfwAllowPortsScript(ports)];
}

export function stackActionProbe(
  action: StackActionKind,
  components: string[],
  force?: boolean,
): readonly string[] {
  return ["bash", "-lc", buildStackActionScript(action, components, force)];
}

export function maintenanceProbe(): readonly string[] {
  return ["bash", "-lc", buildMaintenanceScript()];
}

export function systemUpdateProbe(): readonly string[] {
  return ["bash", "-lc", buildSystemUpdateScript()];
}

/** Reinicia o servidor em 1 minuto (SSH desconecta antes do reboot). */
export function buildServerRebootScript(): string {
  return [
    "export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH",
    'sync',
    'nohup shutdown -r +1 "OpsPanel: reinicialização agendada" >/dev/null 2>&1 &',
    'echo "OPS_REBOOT_SCHEDULED=1"',
  ].join("; ");
}

export function buildServerStackRestartScript(): string {
  return `${WO_PATH}; ${woCmd("stack restart --all --force")}`;
}

export function serverRebootProbe(): readonly string[] {
  return ["bash", "-lc", buildServerRebootScript()];
}

export function serverStackRestartProbe(): readonly string[] {
  return ["bash", "-lc", buildServerStackRestartScript()];
}

export function healthCollectProbe(): readonly string[] {
  return ["bash", "-lc", buildHealthCollectScript()];
}

export function formatUptime(seconds?: number): string {
  if (seconds == null) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
