export type ParsedSecurityScan = {
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

const WO_PATH =
  "export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH";

/** Coleta status UFW, fail2ban, portas e SSHD para o Security Center. */
export function buildSecurityScanScript(): string {
  return [
    WO_PATH,
    'echo "===OPS_SECURITY==="',
    'echo "COLLECTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)"',
    'if command -v ufw >/dev/null 2>&1; then',
    '  st=$(ufw status 2>/dev/null | head -1 || true)',
    '  if echo "$st" | grep -qi active; then echo "UFW_ACTIVE=1"; else echo "UFW_ACTIVE=0"; fi',
    '  def=$(ufw status verbose 2>/dev/null | grep -i "Default:" | head -1 || true)',
    '  echo "UFW_DEFAULT=$def"',
    '  ports=$(ufw status numbered 2>/dev/null | grep -oE "[0-9]+/(tcp|udp)" | cut -d/ -f1 | sort -n | uniq | tr "\\n" "," || true)',
    '  echo "UFW_PORTS=$ports"',
    'else',
    '  echo "UFW_ACTIVE=0"',
    '  echo "UFW_DEFAULT="',
    '  echo "UFW_PORTS="',
    'fi',
    'if command -v fail2ban-client >/dev/null 2>&1; then',
    '  jails=$(fail2ban-client status 2>/dev/null | grep -i "Jail list" | sed "s/.*://;s/,/ /g;s/[[:space:]]\\+/ /g" | xargs || true)',
    '  echo "F2B_JAILS=$jails"',
    '  banned=0',
    '  for j in $jails; do',
    '    c=$(fail2ban-client status "$j" 2>/dev/null | grep -i "Currently banned" | grep -oE "[0-9]+" | head -1 || echo 0)',
    '    banned=$((banned + ${c:-0}))',
    '  done',
    '  echo "F2B_BANNED=$banned"',
    'else',
    '  echo "F2B_JAILS="',
    '  echo "F2B_BANNED=0"',
    'fi',
    'listen=$(ss -tlnH 2>/dev/null | awk \'{print $4}\' | grep -oE "[0-9]+$" | sort -n | uniq | tr "\\n" "," || true)',
    'echo "LISTEN_PORTS=$listen"',
    'if [ -f /etc/ssh/sshd_config ]; then',
    '  pr=$(grep -Ei "^[[:space:]]*PermitRootLogin" /etc/ssh/sshd_config | awk \'{print $2}\' | tail -1 || true)',
    '  pa=$(grep -Ei "^[[:space:]]*PasswordAuthentication" /etc/ssh/sshd_config | awk \'{print $2}\' | tail -1 || true)',
    '  echo "SSH_PERMIT_ROOT=${pr:-unknown}"',
    '  echo "SSH_PASSWORD_AUTH=${pa:-unknown}"',
    'else',
    '  echo "SSH_PERMIT_ROOT=unknown"',
    '  echo "SSH_PASSWORD_AUTH=unknown"',
    'fi',
    'echo "===OPS_SECURITY_END==="',
  ].join("\n");
}

export function securityScanProbe(): readonly string[] {
  return ["bash", "-lc", buildSecurityScanScript()];
}

function parsePortList(raw?: string): number[] {
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(",")
        .map((p) => Number(p.trim()))
        .filter((n) => Number.isFinite(n) && n > 0 && n < 65536),
    ),
  ];
}

export function parseSecurityScanOutput(output: string): ParsedSecurityScan {
  const start = output.indexOf("===OPS_SECURITY===");
  const end = output.indexOf("===OPS_SECURITY_END===");
  const block = start >= 0 ? output.slice(start, end >= 0 ? end : undefined) : output;
  const get = (key: string) => {
    const m = block.match(new RegExp(`^${key}=(.*)$`, "m"));
    return m?.[1]?.trim();
  };

  const collectedAt = get("COLLECTED_AT") || new Date().toISOString();
  const ufwActive = get("UFW_ACTIVE") === "1";
  const ufwDefault = get("UFW_DEFAULT") || undefined;
  const jailsRaw = get("F2B_JAILS") || "";
  const fail2banJails = jailsRaw
    ? jailsRaw.split(/\s+/).map((j) => j.trim()).filter(Boolean)
    : [];
  const banned = Number(get("F2B_BANNED") || "0");

  return {
    collectedAt,
    ufwActive,
    ufwDefaultIncoming: ufwDefault,
    ufwOpenPorts: parsePortList(get("UFW_PORTS")),
    fail2banJails,
    fail2banBannedTotal: Number.isFinite(banned) ? banned : 0,
    listeningTcpPorts: parsePortList(get("LISTEN_PORTS")),
    permitRootLogin: get("SSH_PERMIT_ROOT"),
    passwordAuthentication: get("SSH_PASSWORD_AUTH"),
  };
}
