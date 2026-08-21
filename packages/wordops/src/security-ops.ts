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

const WO_PATH =
  "export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH";

/** Coleta status UFW, fail2ban, portas, SSHD e ferramentas gratuitas de hardening. */
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
    'if command -v lynis >/dev/null 2>&1; then',
    '  echo "LYNIS_INSTALLED=1"',
    '  idx=$(grep -E "hardening_index|Hardening index" /var/log/lynis-report.dat /var/log/lynis.log 2>/dev/null | grep -oE "[0-9]+" | head -1 || true)',
    '  warn=$(grep -cE "^warning\\[|\\[WARNING\\]" /var/log/lynis.log 2>/dev/null || echo 0)',
    '  sugg=$(grep -cE "^suggestion\\[|\\[SUGGESTION\\]" /var/log/lynis.log 2>/dev/null || echo 0)',
    '  echo "LYNIS_INDEX=${idx:-}"',
    '  echo "LYNIS_WARNINGS=${warn:-0}"',
    '  echo "LYNIS_SUGGESTIONS=${sugg:-0}"',
    'else',
    '  echo "LYNIS_INSTALLED=0"',
    '  echo "LYNIS_INDEX="',
    '  echo "LYNIS_WARNINGS=0"',
    '  echo "LYNIS_SUGGESTIONS=0"',
    'fi',
    'if command -v clamscan >/dev/null 2>&1 || command -v clamdscan >/dev/null 2>&1; then',
    '  echo "CLAMAV_INSTALLED=1"',
    '  if systemctl is-active --quiet clamav-freshclam 2>/dev/null || systemctl is-active --quiet freshclam 2>/dev/null; then echo "CLAMAV_FRESH=1"; else echo "CLAMAV_FRESH=0"; fi',
    '  last=$(ls -1t /var/log/clamav/*.log /var/log/clamav.log 2>/dev/null | head -1 || true)',
    '  if [ -n "$last" ]; then echo "CLAMAV_LAST=$(date -u -r "$last" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || true)"; else echo "CLAMAV_LAST="; fi',
    'else',
    '  echo "CLAMAV_INSTALLED=0"',
    '  echo "CLAMAV_FRESH=0"',
    '  echo "CLAMAV_LAST="',
    'fi',
    'if command -v chkrootkit >/dev/null 2>&1; then echo "CHKROOTKIT_INSTALLED=1"; else echo "CHKROOTKIT_INSTALLED=0"; fi',
    'if command -v rkhunter >/dev/null 2>&1; then echo "RKHUNTER_INSTALLED=1"; else echo "RKHUNTER_INSTALLED=0"; fi',
    'if command -v cscli >/dev/null 2>&1 || command -v crowdsec >/dev/null 2>&1; then',
    '  echo "CROWDSEC_INSTALLED=1"',
    '  if systemctl is-active --quiet crowdsec 2>/dev/null; then echo "CROWDSEC_RUNNING=1"; else echo "CROWDSEC_RUNNING=0"; fi',
    'else',
    '  echo "CROWDSEC_INSTALLED=0"',
    '  echo "CROWDSEC_RUNNING=0"',
    'fi',
    'if dpkg -l unattended-upgrades 2>/dev/null | grep -q "^ii"; then',
    '  if [ -f /etc/apt/apt.conf.d/20auto-upgrades ]; then',
    '    au=$(grep -E "APT::Periodic::Unattended-Upgrade" /etc/apt/apt.conf.d/20auto-upgrades 2>/dev/null | grep -oE "[0-9]+" | head -1 || echo 0)',
    '    if [ "${au:-0}" != "0" ]; then echo "UNATTENDED_ENABLED=1"; else echo "UNATTENDED_ENABLED=0"; fi',
    '  else',
    '    echo "UNATTENDED_ENABLED=0"',
    '  fi',
    'elif [ -f /etc/apt/apt.conf.d/20auto-upgrades ]; then',
    '  au=$(grep -E "APT::Periodic::Unattended-Upgrade" /etc/apt/apt.conf.d/20auto-upgrades 2>/dev/null | grep -oE "[0-9]+" | head -1 || echo 0)',
    '  if [ "${au:-0}" != "0" ]; then echo "UNATTENDED_ENABLED=1"; else echo "UNATTENDED_ENABLED=0"; fi',
    'else',
    '  echo "UNATTENDED_ENABLED=0"',
    'fi',
    'if command -v aide >/dev/null 2>&1; then',
    '  echo "AIDE_INSTALLED=1"',
    '  if [ -f /var/lib/aide/aide.db ] || [ -f /var/lib/aide/aide.db.gz ] || [ -f /var/lib/aide/aide.db.new ]; then echo "AIDE_DB=1"; else echo "AIDE_DB=0"; fi',
    'else',
    '  echo "AIDE_INSTALLED=0"',
    '  echo "AIDE_DB=0"',
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

function flag(get: (k: string) => string | undefined, key: string): boolean {
  return get(key) === "1";
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

  const lynisInstalled = flag(get, "LYNIS_INSTALLED");
  const idxRaw = get("LYNIS_INDEX");
  const lynisHardeningIndex = idxRaw && Number.isFinite(Number(idxRaw)) ? Number(idxRaw) : null;
  const lynisWarnings = Number(get("LYNIS_WARNINGS") || "0");
  const lynisSuggestions = Number(get("LYNIS_SUGGESTIONS") || "0");
  const clamLast = get("CLAMAV_LAST");

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
    lynisInstalled,
    lynisHardeningIndex,
    lynisWarnings: Number.isFinite(lynisWarnings) ? lynisWarnings : 0,
    lynisSuggestions: Number.isFinite(lynisSuggestions) ? lynisSuggestions : 0,
    clamavInstalled: flag(get, "CLAMAV_INSTALLED"),
    clamavFresh: flag(get, "CLAMAV_FRESH"),
    clamavLastScanAt: clamLast || null,
    chkrootkitInstalled: flag(get, "CHKROOTKIT_INSTALLED"),
    rkhunterInstalled: flag(get, "RKHUNTER_INSTALLED"),
    crowdsecInstalled: flag(get, "CROWDSEC_INSTALLED"),
    crowdsecRunning: flag(get, "CROWDSEC_RUNNING"),
    unattendedUpgradesEnabled: flag(get, "UNATTENDED_ENABLED"),
    aideInstalled: flag(get, "AIDE_INSTALLED"),
    aideDbExists: flag(get, "AIDE_DB"),
  };
}
