export type SiteCreateType =
  | "html"
  | "php"
  | "mysql"
  | "wp"
  | "wpfc"
  | "wpredis"
  | "wpsc"
  | "wprocket"
  | "wpce"
  | "proxy"
  | "alias";

export interface SiteCreateParams {
  domain: string;
  siteType: SiteCreateType;
  multisite?: "none" | "subdir" | "subdomain";
  phpVersion?: "default" | "74" | "80" | "81" | "82" | "83" | "84";
  sslMode?: "none" | "letsencrypt" | "letsencrypt_dns_cf" | "letsencrypt_wildcard_cf";
  hsts?: boolean;
  ngxblocker?: boolean;
  vhostOnly?: boolean;
  proxyTarget?: string;
  aliasTarget?: string;
  cloudflareApiKey?: string;
  cloudflareEmail?: string;
  wpUser?: string;
  wpPass?: string;
  wpEmail?: string;
}

const DOMAIN_REGEX = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

const WO_PATH =
  "export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH";

const TYPE_FLAGS: Record<SiteCreateType, string> = {
  html: "--html",
  php: "--php",
  mysql: "--mysql",
  wp: "--wp",
  wpfc: "--wpfc",
  wpredis: "--wpredis",
  wpsc: "--wpsc",
  wprocket: "--wprocket",
  wpce: "--wpce",
  proxy: "--proxy",
  alias: "--alias",
};

const PHP_FLAGS: Record<string, string> = {
  "74": "--php74",
  "80": "--php80",
  "81": "--php81",
  "82": "--php82",
  "83": "--php83",
  "84": "--php84",
};

const SSL_FLAGS: Record<string, string[]> = {
  none: [],
  letsencrypt: ["-le"],
  letsencrypt_dns_cf: ["--letsencrypt", "--dns=dns_cf"],
  letsencrypt_wildcard_cf: ["--letsencrypt=wildcard", "--dns=dns_cf"],
};

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function woCmd(subcommand: string): string {
  return `(command -v wo >/dev/null && wo ${subcommand}) || (/usr/local/bin/wo ${subcommand})`;
}

export function validateDomain(domain: string): boolean {
  return DOMAIN_REGEX.test(domain.toLowerCase());
}

function buildCloudflareExports(apiKey?: string, email?: string): string {
  if (!apiKey || !email) return "";
  return `export CF_Key=${shellQuote(apiKey)} CF_Email=${shellQuote(email)};`;
}

function buildTypeFlags(input: SiteCreateParams): string[] {
  const flags: string[] = [];
  const ms = input.multisite ?? "none";

  if (input.siteType === "proxy" && input.proxyTarget) {
    flags.push(`--proxy=${shellQuote(input.proxyTarget)}`);
    return flags;
  }
  if (input.siteType === "alias" && input.aliasTarget) {
    flags.push(`--alias=${shellQuote(input.aliasTarget)}`);
    return flags;
  }

  if (ms === "subdir") {
    flags.push("--wpsubdir");
    if (input.siteType !== "wp") flags.push(TYPE_FLAGS[input.siteType]);
  } else if (ms === "subdomain") {
    flags.push("--wpsubdomain");
    if (input.siteType !== "wp") flags.push(TYPE_FLAGS[input.siteType]);
  } else {
    flags.push(TYPE_FLAGS[input.siteType]);
  }

  return flags;
}

export function buildSiteCreateScript(input: SiteCreateParams): string {
  const domain = input.domain.toLowerCase();
  if (!validateDomain(domain)) throw new Error("Domínio inválido");

  const flags = buildTypeFlags(input);

  const php = input.phpVersion && input.phpVersion !== "default" ? PHP_FLAGS[input.phpVersion] : null;
  if (php) flags.push(php);

  const sslMode = input.sslMode ?? "none";
  flags.push(...(SSL_FLAGS[sslMode] ?? []));

  if (input.hsts) flags.push("--hsts");
  if (input.ngxblocker) flags.push("--ngxblocker");
  if (input.vhostOnly) flags.push("--vhostonly");
  if (input.wpUser) flags.push(`--user=${shellQuote(input.wpUser)}`);
  if (input.wpPass) flags.push(`--pass=${shellQuote(input.wpPass)}`);
  if (input.wpEmail) flags.push(`--email=${shellQuote(input.wpEmail)}`);

  const cf = buildCloudflareExports(input.cloudflareApiKey, input.cloudflareEmail);
  const createCmd = woCmd(`site create ${shellQuote(domain)} ${flags.join(" ")}`);
  return `${WO_PATH}; ${cf}${createCmd}; RC=$?; if [ $RC -eq 0 ]; then echo "OPS_SITE_CREATE_DONE=1"; else echo "OPS_SITE_CREATE_FAILED=$RC"; fi; exit $RC`;
}

export function parseSiteCreateOutput(output: string): {
  ok: boolean;
  done: boolean;
  failed: boolean;
  errorHint?: string;
} {
  const text = stripAnsi(output);
  const done = /OPS_SITE_CREATE_DONE=1/.test(text);
  const failed = /OPS_SITE_CREATE_FAILED=/.test(text);
  if (done) return { ok: true, done: true, failed: false };
  if (/Success.*https?:\/\//i.test(text) || /WordPress admin user/i.test(text)) {
    return { ok: true, done: true, failed: false };
  }
  if (/Site .* already exists|already present on server/i.test(text)) {
    return { ok: false, done: false, failed: true, errorHint: "Site já existe no servidor" };
  }
  if (failed || /ERROR/i.test(text)) {
    return { ok: false, done: false, failed: true, errorHint: text.slice(-400) };
  }
  return { ok: false, done: false, failed: false };
}

export function estimateSiteCreateProgress(output: string): number {
  const text = stripAnsi(output).toLowerCase();
  if (/ops_site_create_done=1/.test(text)) return 95;
  if (/installing wordpress/.test(text)) return 85;
  if (/configuring wordpress/.test(text)) return 75;
  if (/setting up database/.test(text)) return 55;
  if (/downloading wordpress/.test(text)) return 45;
  if (/setting up webroot/.test(text)) return 35;
  if (/setting up nginx/.test(text) || /nginx configuration/.test(text)) return 25;
  if (/running pre-run checks/.test(text)) return 15;
  return 10;
}

export type SiteManageAction =
  | "enable"
  | "disable"
  | "letsencrypt"
  | "letsencrypt_dns_cf"
  | "update_wpfc"
  | "update_wpredis"
  | "update_wprocket"
  | "update_wpsc"
  | "update_wpce"
  | "update_php81"
  | "update_php82"
  | "update_php83"
  | "update_php84"
  | "delete";

const UPDATE_FLAGS: Partial<Record<SiteManageAction, string[]>> = {
  update_wpfc: ["--wpfc"],
  update_wpredis: ["--wpredis"],
  update_wprocket: ["--wprocket"],
  update_wpsc: ["--wpsc"],
  update_wpce: ["--wpce"],
  update_php81: ["--php81"],
  update_php82: ["--php82"],
  update_php83: ["--php83"],
  update_php84: ["--php84"],
};

export function buildSiteManageScript(
  domain: string,
  action: SiteManageAction,
  cloudflare?: { apiKey?: string; email?: string },
): string {
  const d = domain.toLowerCase();
  if (!validateDomain(d)) throw new Error("Domínio inválido");

  const cf = buildCloudflareExports(cloudflare?.apiKey, cloudflare?.email);

  switch (action) {
    case "enable":
      return `${WO_PATH}; ${woCmd(`site enable ${shellQuote(d)}`)}`;
    case "disable":
      return `${WO_PATH}; ${woCmd(`site disable ${shellQuote(d)}`)}`;
    case "letsencrypt":
      return `${WO_PATH}; ${woCmd(`site update ${shellQuote(d)} -le`)}`;
    case "letsencrypt_dns_cf":
      return `${WO_PATH}; ${cf}${woCmd(`site update ${shellQuote(d)} -le --dns=dns_cf`)}`;
    case "delete":
      return `${WO_PATH}; ${woCmd(`site delete ${shellQuote(d)} --no-prompt`)}`;
    default: {
      const upd = UPDATE_FLAGS[action];
      if (!upd) throw new Error("Ação não suportada");
      return `${WO_PATH}; ${woCmd(`site update ${shellQuote(d)} ${upd.join(" ")}`)}`;
    }
  }
}

function buildSiteFeaturesProbeScript(domain: string): string {
  const d = shellQuote(domain.toLowerCase());
  return [
    `DOMAIN=${d}`,
    `VHOST="/etc/nginx/sites-enabled/$DOMAIN"`,
    `NGINX_CONF=""`,
    `test -f "$VHOST" && NGINX_CONF=$(cat "$VHOST" 2>/dev/null || true)`,
    `CUSTOM_CONF=""`,
    `for _f in /var/www/$DOMAIN/conf/nginx/*.conf; do test -f "$_f" && CUSTOM_CONF="$CUSTOM_CONF$(cat "$_f" 2>/dev/null || true)"; done`,
    `ALL_NGX="$NGINX_CONF $CUSTOM_CONF"`,
    `STACK=""`,
    `case "$ALL_NGX" in *proxy*) STACK=proxy;; *alias*) STACK=alias;; *wprocket*) STACK=wprocket;; *wpfc*) STACK=wpfc;; *wpredis*) STACK=wpredis;; *wpsc*) STACK=wpsc;; *wpce*) STACK=wpce;; *wpcommon*) STACK=wp;; *html*) STACK=html;; *php*) STACK=php;; esac`,
    `HSTS=0`,
    `echo "$ALL_NGX" | grep -qi hsts && HSTS=1`,
    `test -f "/var/www/$DOMAIN/conf/nginx/hsts.conf" && HSTS=1`,
    `NGXBLOCKER=0`,
    `echo "$ALL_NGX" | grep -qi ngxblocker && NGXBLOCKER=1`,
    `test -f "/var/www/$DOMAIN/conf/nginx/ngxblocker.conf" && NGXBLOCKER=1`,
    `SSL_LE=0`,
    `test -d "/etc/letsencrypt/live/$DOMAIN" && SSL_LE=1`,
    `WWW=0`,
    `echo "$NGINX_CONF" | grep -q 'www\\.' && WWW=1`,
    `MULTISITE=none`,
    `WP_CFG="/var/www/$DOMAIN/wp-config.php"`,
    `test -f "$WP_CFG" || WP_CFG="/var/www/$DOMAIN/htdocs/wp-config.php"`,
    `if test -f "$WP_CFG"; then grep -q MULTISITE "$WP_CFG" 2>/dev/null && MULTISITE=multisite; grep -q "SUBDOMAIN_INSTALL.*false" "$WP_CFG" 2>/dev/null && MULTISITE=subdir; grep -q "SUBDOMAIN_INSTALL.*true" "$WP_CFG" 2>/dev/null && MULTISITE=subdomain; fi`,
    `WP=0`,
    `test -f "/var/www/$DOMAIN/htdocs/wp-load.php" && WP=1`,
    `test -f "/var/www/$DOMAIN/wp-load.php" && WP=1`,
    `REDIS=0`,
    `echo "$ALL_NGX" | grep -qi wpredis && REDIS=1`,
    `FASTCGI=0`,
    `echo "$ALL_NGX" | grep -qi wpfc && FASTCGI=1`,
    `echo "OPS_SITE_FEATURES_START"`,
    `echo "hsts=$HSTS"`,
    `echo "ngxblocker=$NGXBLOCKER"`,
    `echo "ssl_le=$SSL_LE"`,
    `echo "www_alias=$WWW"`,
    `echo "multisite=$MULTISITE"`,
    `echo "wordpress=$WP"`,
    `echo "nginx_stack=$STACK"`,
    `echo "redis_cache=$REDIS"`,
    `echo "fastcgi_cache=$FASTCGI"`,
    `echo "OPS_SITE_FEATURES_END"`,
  ].join("; ");
}

export function buildSiteInfoScript(domain: string): string {
  const d = domain.toLowerCase();
  if (!validateDomain(d)) throw new Error("Domínio inválido");
  return `${WO_PATH}; ${woCmd(`site info ${shellQuote(d)}`)}; ${buildSiteFeaturesProbeScript(d)}`;
}

export function buildSiteWpAutologinScript(domain: string, username?: string, webrootHint?: string): string {
  const d = domain.toLowerCase();
  if (!validateDomain(d)) throw new Error("Domínio inválido");

  const resolveUser = username
    ? `WP_USER=${shellQuote(username)}`
    : `WP_USER=$(wp user list --role=administrator --field=user_login --path="$WP_ROOT" --allow-root 2>/dev/null | head -1)`;

  const hintChecks = webrootHint
    ? [
        `HINT=${shellQuote(webrootHint.replace(/\/+$/, ""))}`,
        `if [ -z "$WP_ROOT" ] && [ -f "$HINT/wp-load.php" ]; then WP_ROOT="$HINT"; fi`,
        `if [ -z "$WP_ROOT" ] && [ -f "$HINT/htdocs/wp-load.php" ]; then WP_ROOT="$HINT/htdocs"; fi`,
      ]
    : [];

  return [
    WO_PATH,
    `DOMAIN=${shellQuote(d)}`,
    `SITE_ROOT="/var/www/$DOMAIN"`,
    `WP_ROOT=""`,
    `if [ -f "$SITE_ROOT/htdocs/wp-load.php" ]; then WP_ROOT="$SITE_ROOT/htdocs"; fi`,
    `if [ -z "$WP_ROOT" ] && [ -f "$SITE_ROOT/wp-load.php" ]; then WP_ROOT="$SITE_ROOT"; fi`,
    ...hintChecks,
    `if [ ! -f "$WP_ROOT/wp-load.php" ]; then echo "OPS_WP_LOGIN_ERROR=no_wp"; exit 1; fi`,
    resolveUser,
    `if [ -z "$WP_USER" ]; then echo "OPS_WP_LOGIN_ERROR=no_admin"; exit 1; fi`,
    `LOGIN_OUT=$(wp login create "$WP_USER" --path="$WP_ROOT" --allow-root 2>/dev/null || true)`,
    `URL=$(printf "%s\\n" "$LOGIN_OUT" | grep -Eo "https?://[^[:space:]]+" | head -1)`,
    `if [ -z "$URL" ]; then yes y 2>/dev/null | wp login install --activate --path="$WP_ROOT" --allow-root >/dev/null 2>&1 || true; LOGIN_OUT=$(wp login create "$WP_USER" --path="$WP_ROOT" --allow-root 2>/dev/null || true); URL=$(printf "%s\\n" "$LOGIN_OUT" | grep -Eo "https?://[^[:space:]]+" | head -1); fi`,
    `if [ -z "$URL" ]; then wp package install aaemnnosttv/wp-cli-login-command --allow-root >/dev/null 2>&1 || true; yes y 2>/dev/null | wp login install --activate --path="$WP_ROOT" --allow-root >/dev/null 2>&1 || true; LOGIN_OUT=$(wp login create "$WP_USER" --path="$WP_ROOT" --allow-root 2>/dev/null || true); URL=$(printf "%s\\n" "$LOGIN_OUT" | grep -Eo "https?://[^[:space:]]+" | head -1); fi`,
    `if [ -z "$URL" ]; then echo "OPS_WP_LOGIN_ERROR=failed"; exit 1; fi`,
    `echo "OPS_WP_LOGIN_URL=$URL"`,
  ].join("; ");
}

export function parseSiteWpAutologinOutput(output: string): { url?: string; error?: string } {
  const text = stripAnsi(output);
  const urlMatch = text.match(/OPS_WP_LOGIN_URL=(\S+)/);
  if (urlMatch?.[1]) return { url: urlMatch[1] };
  const errMatch = text.match(/OPS_WP_LOGIN_ERROR=(\S+)/);
  if (errMatch?.[1]) return { error: errMatch[1] };
  const httpMatch = text.match(/https?:\/\/[^\s'"]+/);
  if (httpMatch?.[0]) return { url: httpMatch[0] };
  return { error: "unknown" };
}

export function siteWpAutologinProbe(domain: string, username?: string, webrootHint?: string): readonly string[] {
  return ["bash", "-lc", buildSiteWpAutologinScript(domain, username, webrootHint)];
}

export function buildFtpUserCreateScript(domain: string, username: string, password: string): string {
  const d = domain.toLowerCase();
  if (!validateDomain(d)) throw new Error("Domínio inválido");
  if (!/^[a-z][a-z0-9_-]*$/i.test(username)) throw new Error("Usuário FTP inválido");

  const home = `/var/www/${d}/htdocs`;
  const user = shellQuote(username);
  const cred = shellQuote(`${username}:${password}`);
  const homeQ = shellQuote(home);

  return [
    WO_PATH,
    `id -u ${user} >/dev/null 2>&1 || adduser --disabled-password --gecos "" --home ${homeQ} --shell /bin/false --ingroup www-data ${user}`,
    `echo ${cred} | chpasswd`,
    `chmod -R g+rw ${homeQ}`,
  ].join("; ");
}

export function buildFtpUserDeleteScript(username: string): string {
  if (!/^[a-z][a-z0-9_-]*$/i.test(username)) throw new Error("Usuário FTP inválido");
  const user = shellQuote(username);
  return [
    WO_PATH,
    `if id -u ${user} >/dev/null 2>&1; then userdel -rf ${user}; fi`,
    `echo "OPS_FTP_USER_DELETED=1"`,
  ].join("; ");
}

export function buildProftpdEnsureScript(): string {
  return [
    WO_PATH,
    `HOST=$(hostname 2>/dev/null || true)`,
    `IP=$(hostname -I 2>/dev/null | awk '{print $1}')`,
    `if [ -n "$HOST" ] && [ -n "$IP" ] && ! getent hosts "$HOST" >/dev/null 2>&1; then`,
    `  grep -qw "$HOST" /etc/hosts 2>/dev/null || printf '%s\\t%s\\n' "$IP" "$HOST" >> /etc/hosts`,
    `fi`,
    `if ! command -v proftpd >/dev/null 2>&1; then ${woCmd("stack install --proftpd --force")}; fi`,
    `systemctl enable proftpd 2>/dev/null || true`,
    `if ! proftpd -t >/dev/null 2>&1; then`,
    `  sed -i 's/^UseIPv6 on/UseIPv6 off/' /etc/proftpd/proftpd.conf 2>/dev/null || true`,
    `  if [ -n "$IP" ] && ! grep -q '^DefaultAddress' /etc/proftpd/proftpd.conf 2>/dev/null; then`,
    `    echo "DefaultAddress $IP" >> /etc/proftpd/proftpd.conf`,
    `  fi`,
    `fi`,
    `if ! systemctl is-active proftpd >/dev/null 2>&1; then`,
    `  systemctl restart proftpd 2>/dev/null || systemctl start proftpd 2>/dev/null || ${woCmd("stack start --proftpd")}`,
    `fi`,
    `if ! systemctl is-active proftpd >/dev/null 2>&1; then`,
    `  J=$(journalctl -u proftpd -n 5 --no-pager 2>&1 | grep -Ei 'fatal|error' | tail -1)`,
    `  echo "OPS_FTP_ERROR=proftpd_not_running"`,
    `  [ -n "$J" ] && echo "OPS_FTP_DETAIL=$J"`,
    `  exit 1`,
    `fi`,
    `echo "OPS_FTP_PROFTPD_OK=1"`,
  ].join("\n");
}

export function parseProftpdEnsureOutput(output: string): string | null {
  const text = stripAnsi(output).replace(/\r/g, "");
  const detailMatch = text.match(/OPS_FTP_DETAIL=(.+)/);
  if (detailMatch?.[1]) {
    const detail = detailMatch[1].trim();
    if (/unable to determine IP address/i.test(detail)) {
      return "ProFTPd não iniciou: o hostname do servidor não estava em /etc/hosts.";
    }
    const cleaned = detail.replace(/^.*proftpd\[\d+\]: /, "");
    return `ProFTPd não iniciou: ${cleaned}`;
  }
  if (/OPS_FTP_ERROR=proftpd_not_running/.test(text)) {
    const fatal = text.match(/proftpd\[\d+\]: (?:fatal|error):[^\n]+/i)?.[0];
    if (fatal) return `ProFTPd não iniciou: ${fatal.replace(/^.*proftpd\[\d+\]: /, "")}`;
    return "ProFTPd não iniciou. Verifique systemctl status proftpd no servidor.";
  }
  return null;
}

export function proftpdEnsureProbe(): readonly string[] {
  return ["bash", "-lc", buildProftpdEnsureScript()];
}

export function ftpUserDeleteProbe(username: string): readonly string[] {
  return ["bash", "-lc", buildFtpUserDeleteScript(username)];
}

export interface ParsedSiteInfo {
  domain?: string;
  siteType?: string;
  nginxConfig?: string;
  phpVersion?: string;
  cacheBackend?: string;
  isEnabled?: boolean;
  isWordPress?: boolean;
  sslEnabled?: boolean;
  sslProvider?: string;
  sslExpiryDays?: number;
  sslLetsEncrypt?: boolean;
  hstsEnabled?: boolean;
  ngxblockerEnabled?: boolean;
  wwwAlias?: boolean;
  multisite?: "none" | "subdir" | "subdomain" | "multisite";
  redisObjectCache?: boolean;
  fastcgiCache?: boolean;
  webroot?: string;
  accessLog?: string;
  errorLog?: string;
  dbName?: string;
  dbUser?: string;
  dbPass?: string;
  dbHost?: string;
  collectedAt?: string;
  raw?: string;
}

function applySiteFeaturesMarkers(info: ParsedSiteInfo, output: string): void {
  const block = output.match(/OPS_SITE_FEATURES_START([\s\S]*?)OPS_SITE_FEATURES_END/);
  if (!block?.[1]) return;

  for (const rawLine of block[1].split("\n")) {
    const line = rawLine.trim();
    const match = line.match(/^([a-z_]+)=(.*)$/);
    if (!match) continue;
    const key = match[1]!;
    const val = match[2]!.trim();

    switch (key) {
      case "hsts":
        info.hstsEnabled = val === "1";
        break;
      case "ngxblocker":
        info.ngxblockerEnabled = val === "1";
        break;
      case "ssl_le":
        info.sslLetsEncrypt = val === "1";
        if (val === "1" && info.sslEnabled == null) info.sslEnabled = true;
        break;
      case "www_alias":
        info.wwwAlias = val === "1";
        break;
      case "multisite":
        if (val === "subdir" || val === "subdomain" || val === "multisite" || val === "none") {
          info.multisite = val;
        }
        break;
      case "wordpress":
        if (val === "1") info.isWordPress = true;
        break;
      case "nginx_stack":
        if (val) {
          info.siteType = val;
          if (/^wp/i.test(val)) info.isWordPress = true;
        }
        break;
      case "redis_cache":
        info.redisObjectCache = val === "1";
        break;
      case "fastcgi_cache":
        info.fastcgiCache = val === "1";
        break;
    }
  }
}

function applySiteInfoKey(info: ParsedSiteInfo, key: string, val: string): void {
  const k = key.toLowerCase().replace(/\s+/g, "_");

  if (k === "nginx_configuration" || (k.includes("nginx") && k.includes("config"))) {
    info.nginxConfig = val;
    if (/\(enabled\)/i.test(val)) info.isEnabled = true;
    if (/\(disabled\)/i.test(val)) info.isEnabled = false;
    const typeMatch = val.match(/\b(wpfc|wpredis|wprocket|wpsc|wpce|wp|html|php|mysql|proxy|alias)\b/gi);
    if (typeMatch?.length) {
      const preferred = ["wprocket", "wpfc", "wpredis", "wpsc", "wpce", "wp", "html", "php", "mysql", "proxy", "alias"];
      const hit = preferred.find((t) => typeMatch.some((m) => m.toLowerCase() === t));
      if (hit) info.siteType = hit;
    }
    if (/\bwp/i.test(val)) info.isWordPress = true;
    return;
  }

  if (k === "php_version" || k === "php") {
    info.phpVersion = val.replace(/^php\s*/i, "");
    return;
  }
  if (k === "ssl") {
    info.sslEnabled = /enabled|yes|active/i.test(val);
    return;
  }
  if (k === "ssl_provider") {
    info.sslProvider = val;
    return;
  }
  if (k === "ssl_expiry_date") {
    const days = Number.parseInt(val, 10);
    if (Number.isFinite(days)) info.sslExpiryDays = days;
    return;
  }
  if (k === "webroot" || k.includes("web_root")) {
    info.webroot = val;
    return;
  }
  if (k === "access_log") {
    info.accessLog = val;
    return;
  }
  if (k === "error_log") {
    info.errorLog = val;
    return;
  }
  if (k === "db_name" || k === "database") {
    info.dbName = val;
    return;
  }
  if (k === "db_user" || k.includes("db_username")) {
    info.dbUser = val;
    return;
  }
  if (k === "db_pass" || k === "db_password") {
    info.dbPass = val;
    return;
  }
  if (k === "db_host") {
    info.dbHost = val;
    return;
  }
  if (k.includes("cache")) {
    info.cacheBackend = val;
    return;
  }
  if (k.includes("type") || k.includes("stack")) {
    info.siteType = val.toLowerCase();
    return;
  }
  if (k.includes("status")) {
    info.isEnabled = !/disabled|off/i.test(val);
  }
}

export function parseSiteInfoOutput(output: string): ParsedSiteInfo {
  const text = stripAnsi(output);
  const info: ParsedSiteInfo = {
    collectedAt: new Date().toISOString(),
    raw: text.slice(0, 4000),
  };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const about = line.match(/^Information about\s+(\S+)/i);
    if (about) {
      info.domain = about[1]!.replace(/[()]/g, "");
      continue;
    }

    const underscored = line.match(/^(DB_[A-Z_]+)\s{2,}(.+)$/i);
    if (underscored) {
      applySiteInfoKey(info, underscored[1]!, underscored[2]!.trim());
      continue;
    }

    const spaced = line.match(/^([A-Za-z][A-Za-z0-9 _/]*?)\s{2,}(.+)$/);
    if (spaced) {
      applySiteInfoKey(info, spaced[1]!.trim(), spaced[2]!.trim());
      continue;
    }

    const colon = line.match(/^([^:]+):\s*(.+)$/);
    if (colon) {
      applySiteInfoKey(info, colon[1]!.trim(), colon[2]!.trim());
      continue;
    }

    if (/wordpress/i.test(line)) {
      info.isWordPress = true;
      info.siteType = info.siteType ?? "wp";
    }
    if (/php\s*[\d.]+/i.test(line)) {
      const m = line.match(/php\s*([\d.]+)/i);
      if (m) info.phpVersion = m[1];
    }
    if (/redis|fastcgi|super.?cache|wp.?rocket|cache enabler/i.test(line)) {
      info.cacheBackend = line;
    }
  }

  if (!info.dbHost && (info.dbName || info.dbUser)) {
    info.dbHost = "localhost";
  }

  applySiteFeaturesMarkers(info, text);

  if (info.multisite === "none" || info.multisite == null) {
    info.multisite = "none";
  }

  return info;
}

export function siteInfoProbe(domain: string): readonly string[] {
  return ["bash", "-lc", buildSiteInfoScript(domain)];
}

export function siteCreateProbe(input: SiteCreateParams): readonly string[] {
  return ["bash", "-lc", buildSiteCreateScript(input)];
}

export function siteManageProbe(
  domain: string,
  action: SiteManageAction,
  cloudflare?: { apiKey?: string; email?: string },
): readonly string[] {
  return ["bash", "-lc", buildSiteManageScript(domain, action, cloudflare)];
}

export interface SiteDbCredentials {
  name: string;
  user: string;
  pass: string;
  host?: string;
}

export interface ParsedSiteBackupOutput {
  ok: boolean;
  backupPath?: string;
  filesArchive?: string;
  databaseArchive?: string;
  error?: string;
}

/** Lê `KEY=value` só no começo da linha. Evita tratar o próprio script SSH (echo no PTY) como resultado. */
function matchOpsLine(text: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = text.match(new RegExp(`^${escaped}=(.*)$`, "m"));
  const value = m?.[1]?.trim();
  return value || undefined;
}

const RESTORE_ERROR_LABELS: Record<string, string> = {
  invalid_backup_path: "Caminho de backup inválido.",
  backup_not_found: "Backup não encontrado no servidor.",
  files_archive_missing: "O arquivo files.tar.gz não existe neste backup.",
  backup_empty: "Este backup não tem arquivos nem banco.",
  site_root_missing: "A pasta do site não foi encontrada no servidor.",
  wordpress_required_for_db: "Não foi possível importar o banco. WordPress não foi detectado.",
  mode_requires_database: "Este modo precisa de database.sql.gz no backup.",
  mode_requires_files: "Este modo precisa de files.tar.gz no backup.",
  wp_content_not_found: "Não foi possível localizar wp-content no arquivo de backup.",
};

function humanizeRestoreError(raw: string): string {
  const code = raw.split(/[\s;"']/)[0]?.trim() || raw;
  if (RESTORE_ERROR_LABELS[code]) return RESTORE_ERROR_LABELS[code];
  if (raw.length > 80 || /esac|BACKUP_DIR|exit 1/.test(raw)) {
    return "A restauração falhou no servidor. Tente novamente.";
  }
  return raw;
}

export function parseSiteBackupOutput(output: string): ParsedSiteBackupOutput {
  const text = stripAnsi(output).replace(/\r/g, "");
  const err = matchOpsLine(text, "OPS_BACKUP_ERROR");
  if (err) return { ok: false, error: err.split(/[\s;"']/)[0]!.trim() };

  const kv: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^OPS_BACKUP_(OK|PATH|FILES|DB)=(.*)$/);
    if (m) kv[m[1]!] = m[2]!.trim();
  }
  if (kv.OK === "1" && kv.PATH && (kv.FILES || kv.DB)) {
    return {
      ok: true,
      backupPath: kv.PATH,
      filesArchive: kv.FILES || undefined,
      databaseArchive: kv.DB || undefined,
    };
  }
  const hint = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("tar:"))
    .slice(-8)
    .join(" | ")
    .slice(0, 300);
  return {
    ok: false,
    error: hint ? `Backup incompleto ou não verificado (${hint})` : "Backup incompleto ou não verificado",
  };
}

/** Detecta raiz WordPress (wp-load.php) e wp-config.php no layout WordOps. */
export function buildWordPressPathDetectionScript(): string {
  return [
    `WP_ROOT=""`,
    `WP_CFG=""`,
    `if [ -f "$SITE_ROOT/htdocs/wp-load.php" ]; then WP_ROOT="$SITE_ROOT/htdocs"; fi`,
    `if [ -z "$WP_ROOT" ] && [ -f "$SITE_ROOT/wp-load.php" ]; then WP_ROOT="$SITE_ROOT"; fi`,
    `if [ -f "$SITE_ROOT/wp-config.php" ]; then WP_CFG="$SITE_ROOT/wp-config.php"; elif [ -f "$SITE_ROOT/htdocs/wp-config.php" ]; then WP_CFG="$SITE_ROOT/htdocs/wp-config.php"; fi`,
  ].join("; ");
}

export type SiteBackupContents = "files_and_database" | "files_only" | "database_only";

export function buildSiteBackupScript(
  domain: string,
  db?: SiteDbCredentials,
  contents: SiteBackupContents = "files_and_database",
): string {
  const d = domain.toLowerCase();
  if (!validateDomain(d)) throw new Error("Domínio inválido");

  const wantFiles = contents !== "database_only";
  const wantDb = contents !== "files_only";
  const wpPaths = buildWordPressPathDetectionScript();

  const dbExport = !wantDb
    ? `echo "OPS_BACKUP_DB_SKIP=1"`
    : db
      ? [
          `mysqldump --single-transaction --quick --lock-tables=false -h ${shellQuote(db.host ?? "localhost")} -u ${shellQuote(db.user)} -p${shellQuote(db.pass)} ${shellQuote(db.name)} > "$BACKUP_DIR/database.sql" 2>/dev/null`,
          `test -s "$BACKUP_DIR/database.sql" || { echo "OPS_BACKUP_ERROR=db_export_failed"; exit 1; }`,
          `gzip -f "$BACKUP_DIR/database.sql"`,
          `echo "OPS_BACKUP_DB=$BACKUP_DIR/database.sql.gz"`,
        ].join("; ")
      : [
          `if [ -n "$WP_ROOT" ]; then wp db export "$BACKUP_DIR/database.sql" --path="$WP_ROOT" --allow-root --single-transaction >/dev/null 2>&1 && gzip -f "$BACKUP_DIR/database.sql" && echo "OPS_BACKUP_DB=$BACKUP_DIR/database.sql.gz"; fi`,
          `if [ ! -f "$BACKUP_DIR/database.sql.gz" ] && [ -n "$WP_ROOT" ]; then DB_NAME=$(wp config get DB_NAME --path="$WP_ROOT" --allow-root 2>/dev/null); DB_USER=$(wp config get DB_USER --path="$WP_ROOT" --allow-root 2>/dev/null); DB_PASS=$(wp config get DB_PASSWORD --path="$WP_ROOT" --allow-root 2>/dev/null); DB_HOST=$(wp config get DB_HOST --path="$WP_ROOT" --allow-root 2>/dev/null || echo localhost); if [ -n "$DB_NAME" ] && [ -n "$DB_USER" ] && [ -n "$DB_PASS" ]; then mysqldump --single-transaction --quick --lock-tables=false -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" > "$BACKUP_DIR/database.sql" 2>/dev/null && test -s "$BACKUP_DIR/database.sql" && gzip -f "$BACKUP_DIR/database.sql" && echo "OPS_BACKUP_DB=$BACKUP_DIR/database.sql.gz"; fi; fi`,
        ].join("; ");

  const filesArchive = wantFiles
    ? [
        `tar -czf "$BACKUP_DIR/files.tar.gz" --exclude='./htdocs/wp-content/cache' --exclude='./htdocs/wp-content/wflogs' --exclude='./htdocs/wp-content/uploads/wc-logs' --exclude='./htdocs/wp-content/ai1wm-backups' --exclude='*.log' -C "$SITE_ROOT" . >/dev/null 2>"$BACKUP_DIR/tar.stderr"`,
        `TAR_RC=$?`,
        `if [ ! -s "$BACKUP_DIR/files.tar.gz" ] || [ "$TAR_RC" -ge 2 ]; then echo "OPS_BACKUP_ERROR=files_archive_failed"; tail -c 400 "$BACKUP_DIR/tar.stderr" 2>/dev/null; exit 1; fi`,
        `rm -f "$BACKUP_DIR/tar.stderr"`,
        `echo "OPS_BACKUP_FILES=$BACKUP_DIR/files.tar.gz"`,
      ].join("; ")
    : `echo "OPS_BACKUP_FILES_SKIP=1"`;

  const dbRequired =
    wantDb
      ? `if [ -n "$WP_ROOT" ]; then test -f "$BACKUP_DIR/database.sql.gz" || { echo "OPS_BACKUP_ERROR=wordpress_db_required"; exit 1; }; fi`
      : `true`;

  return [
    WO_PATH,
    `set +e`,
    `DOMAIN=${shellQuote(d)}`,
    `TS=$(date +%Y%m%d%H%M%S)`,
    `BACKUP_DIR="/var/backups/opspanel/${d}/$TS"`,
    `SITE_ROOT="/var/www/${d}"`,
    wpPaths,
    `mkdir -p "$BACKUP_DIR"`,
    `test -d "$SITE_ROOT" || { echo "OPS_BACKUP_ERROR=site_root_missing"; exit 1; }`,
    filesArchive,
    dbExport,
    dbRequired,
    `echo "OPS_BACKUP_OK=1"`,
    `echo "OPS_BACKUP_PATH=$BACKUP_DIR"`,
    `exit 0`,
  ].join("; ");
}

export function buildSiteDeleteScript(domain: string): string {
  const d = domain.toLowerCase();
  if (!validateDomain(d)) throw new Error("Domínio inválido");
  return `${WO_PATH}; ${woCmd(`site delete ${shellQuote(d)} --no-prompt`)}`;
}

export function buildSiteUpdateDomainScript(oldDomain: string, newDomain: string): string {
  const oldD = oldDomain.toLowerCase();
  const newD = newDomain.toLowerCase();
  if (!validateDomain(oldD) || !validateDomain(newD)) throw new Error("Domínio inválido");
  if (oldD === newD) throw new Error("Domínios iguais");

  return [
    WO_PATH,
    `OLD=${shellQuote(oldD)}`,
    `NEW=${shellQuote(newD)}`,
    `test ! -d "/var/www/$NEW" || { echo "OPS_DOMAIN_ERROR=target_exists"; exit 1; }`,
    `test -d "/var/www/$OLD" || { echo "OPS_DOMAIN_ERROR=source_missing"; exit 1; }`,
    `SITE_ID=$(sqlite3 /var/lib/wo/dbase.db "SELECT id FROM sites WHERE sitename='$oldD' LIMIT 1;" 2>/dev/null || true)`,
    `test -n "$SITE_ID" || { echo "OPS_DOMAIN_ERROR=wordops_site_not_found"; exit 1; }`,
    `mv "/var/www/$OLD" "/var/www/$NEW"`,
    `sqlite3 /var/lib/wo/dbase.db "UPDATE sites SET sitename='$newD', site_path='/var/www/$NEW', is_ssl=0 WHERE id=$SITE_ID;"`,
    `rm -f "/etc/nginx/sites-enabled/$OLD"`,
    `rm -f "/etc/nginx/conf.d/force-ssl-\${OLD}.conf" 2>/dev/null || true`,
    `if [ -f "/etc/nginx/sites-available/$OLD" ]; then mv "/etc/nginx/sites-available/$OLD" "/etc/nginx/sites-available/$NEW"; sed -i "s/$OLD/$NEW/g" "/etc/nginx/sites-available/$NEW"; ln -sf "/etc/nginx/sites-available/$NEW" "/etc/nginx/sites-enabled/$NEW"; fi`,
    `if [ -f "/var/www/$NEW/htdocs/wp-config.php" ]; then wp search-replace "https://$OLD" "https://$NEW" --path="/var/www/$NEW/htdocs" --all-tables --allow-root 2>/dev/null || true; wp search-replace "http://$OLD" "http://$NEW" --path="/var/www/$NEW/htdocs" --all-tables --allow-root 2>/dev/null || true; fi`,
    `nginx -t && (${woCmd("stack reload --nginx")} 2>/dev/null || systemctl reload nginx 2>/dev/null || service nginx reload 2>/dev/null || true)`,
    `echo "OPS_DOMAIN_UPDATED=1"`,
    `echo "OPS_NEW_DOMAIN=$NEW"`,
  ].join("; ");
}

export function siteBackupProbe(
  domain: string,
  db?: SiteDbCredentials,
  contents: SiteBackupContents = "files_and_database",
): readonly string[] {
  return ["bash", "-lc", buildSiteBackupScript(domain, db, contents)];
}

export type SiteBackupIntegrity = "ok" | "warning" | "unknown";

export interface SiteBackupListEntry {
  path: string;
  timestamp: string;
  hasDatabase: boolean;
  hasFiles: boolean;
  filesSizeBytes: number;
  integrity: SiteBackupIntegrity;
}

export function parseSiteBackupListOutput(output: string): SiteBackupListEntry[] {
  const entries: SiteBackupListEntry[] = [];
  for (const line of stripAnsi(output).replace(/\r/g, "").split("\n")) {
    const m = line.match(/^OPS_BACKUP_ENTRY=(.+)$/);
    if (!m) continue;
    const parts = m[1]!.split("|");
    if (parts.length < 4) continue;
    const [timestamp, path, hasDb, sizeRaw, hasFilesRaw, integrityRaw] = parts;
    if (!timestamp || !path) continue;
    const integrity: SiteBackupIntegrity =
      integrityRaw === "ok" || integrityRaw === "warning" || integrityRaw === "unknown"
        ? integrityRaw
        : "unknown";
    entries.push({
      timestamp,
      path,
      hasDatabase: hasDb === "1",
      hasFiles: hasFilesRaw == null ? true : hasFilesRaw === "1",
      filesSizeBytes: parseInt(sizeRaw ?? "0", 10) || 0,
      integrity,
    });
  }
  return entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export function buildSiteBackupListScript(domain: string): string {
  const d = domain.toLowerCase();
  if (!validateDomain(d)) throw new Error("Domínio inválido");
  return [
    `BACKUP_ROOT="/var/backups/opspanel/${d}"`,
    `if [ ! -d "$BACKUP_ROOT" ]; then echo "OPS_BACKUP_LIST_OK=1"; exit 0; fi`,
    `find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort -r | while IFS= read -r dir; do`,
    `  TS=$(basename "$dir")`,
    `  HAS_DB=0; HAS_FILES=0; SIZE=0; INTEGRITY=unknown`,
    `  [ -f "$dir/database.sql.gz" ] && HAS_DB=1`,
    `  if [ -f "$dir/files.tar.gz" ]; then HAS_FILES=1; SIZE=$(stat -c%s "$dir/files.tar.gz" 2>/dev/null || echo 0); fi`,
    `  if [ "$HAS_DB" = "0" ] && [ "$HAS_FILES" = "0" ]; then continue; fi`,
    `  if [ "$SIZE" = "0" ] && [ -f "$dir/database.sql.gz" ]; then SIZE=$(stat -c%s "$dir/database.sql.gz" 2>/dev/null || echo 0); fi`,
    `  BAD=0`,
    `  if [ "$HAS_FILES" = "1" ]; then`,
    `    if gzip -t "$dir/files.tar.gz" 2>/dev/null; then :; else BAD=1; fi`,
    `  fi`,
    `  if [ "$HAS_DB" = "1" ]; then`,
    `    if gzip -t "$dir/database.sql.gz" 2>/dev/null; then :; else BAD=1; fi`,
    `  fi`,
    `  if [ "$HAS_FILES" = "1" ] || [ "$HAS_DB" = "1" ]; then`,
    `    if [ "$BAD" = "1" ]; then INTEGRITY=warning; else INTEGRITY=ok; fi`,
    `  fi`,
    `  echo "OPS_BACKUP_ENTRY=$TS|$dir|$HAS_DB|$SIZE|$HAS_FILES|$INTEGRITY"`,
    `done`,
    `echo "OPS_BACKUP_LIST_OK=1"`,
  ].join("\n");
}

export function buildSiteBackupPruneScript(domain: string, keepLocal: number): string {
  const d = domain.toLowerCase();
  if (!validateDomain(d)) throw new Error("Domínio inválido");
  const keep = Math.max(0, Math.min(30, Math.floor(keepLocal)));
  return [
    `BACKUP_ROOT="/var/backups/opspanel/${d}"`,
    `KEEP=${keep}`,
    `if [ ! -d "$BACKUP_ROOT" ]; then echo "OPS_BACKUP_PRUNE_OK=1"; echo "OPS_BACKUP_PRUNE_DELETED=0"; exit 0; fi`,
    `DELETED=0`,
    `i=0`,
    `for dir in $(ls -1dt "$BACKUP_ROOT"/*/ 2>/dev/null); do`,
    `  i=$((i+1))`,
    `  if [ "$i" -le "$KEEP" ]; then continue; fi`,
    `  rm -rf "$dir" && DELETED=$((DELETED+1)) || true`,
    `done`,
    `echo "OPS_BACKUP_PRUNE_OK=1"`,
    `echo "OPS_BACKUP_PRUNE_DELETED=$DELETED"`,
  ].join("\n");
}

export function siteBackupPruneProbe(domain: string, keepLocal: number): readonly string[] {
  return ["bash", "-lc", buildSiteBackupPruneScript(domain, keepLocal)];
}

export function siteBackupListProbe(domain: string): readonly string[] {
  return ["bash", "-lc", buildSiteBackupListScript(domain)];
}

export interface ParsedSiteRestoreOutput {
  ok: boolean;
  backupPath?: string;
  filesRestored?: boolean;
  databaseRestored?: boolean;
  error?: string;
}

export function parseSiteRestoreOutput(output: string): ParsedSiteRestoreOutput {
  const text = stripAnsi(output).replace(/\r/g, "");

  const kv: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^OPS_RESTORE_(OK|PATH|FILES|DB)=(.*)$/);
    if (m) kv[m[1]!] = m[2]!.trim();
  }
  if (kv.OK === "1" && kv.PATH) {
    return {
      ok: true,
      backupPath: kv.PATH,
      filesRestored: kv.FILES === "1",
      databaseRestored: kv.DB === "1",
    };
  }

  const err = matchOpsLine(text, "OPS_RESTORE_ERROR");
  if (err) return { ok: false, error: humanizeRestoreError(err) };

  const hint = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.includes("echo \"OPS_RESTORE"))
    .slice(-8)
    .join(" | ")
    .slice(0, 180);
  return {
    ok: false,
    error: hint ? `Restauração incompleta (${hint})` : "Restauração incompleta ou não verificada",
  };
}

export type SiteRestoreMode = "full" | "db" | "files" | "wp-content";

export function buildSiteRestoreScript(
  domain: string,
  backupPath: string,
  mode: SiteRestoreMode = "full",
): string {
  const d = domain.toLowerCase();
  if (!validateDomain(d)) throw new Error("Domínio inválido");
  const bp = backupPath.replace(/\/+$/, "");
  const expectedPrefix = `/var/backups/opspanel/${d}/`;
  if (!bp.startsWith(expectedPrefix) || bp.includes("..") || bp === expectedPrefix.slice(0, -1)) {
    throw new Error("Caminho de backup inválido");
  }
  const restoreMode: SiteRestoreMode =
    mode === "db" || mode === "files" || mode === "wp-content" ? mode : "full";

  const wpPaths = buildWordPressPathDetectionScript();
  const wantDb = restoreMode === "full" || restoreMode === "db";
  const wantFiles = restoreMode === "full" || restoreMode === "files";
  const wantWpContent = restoreMode === "wp-content";

  return [
    WO_PATH,
    `set -e`,
    `set -o pipefail`,
    `DOMAIN=${shellQuote(d)}`,
    `BACKUP_DIR=${shellQuote(bp)}`,
    `RESTORE_MODE=${shellQuote(restoreMode)}`,
    `SITE_ROOT="/var/www/${d}"`,
    `BACKUP_ROOT="/var/backups/opspanel/${d}"`,
    `REL="\${BACKUP_DIR#"$BACKUP_ROOT"/}"`,
    `if [ "$REL" = "$BACKUP_DIR" ] || [ -z "$REL" ]; then echo "OPS_RESTORE_ERROR=invalid_backup_path"; exit 1; fi`,
    `test -d "$BACKUP_DIR" || { echo "OPS_RESTORE_ERROR=backup_not_found"; exit 1; }`,
    `HAS_FILES=0; HAS_DB=0`,
    `[ -f "$BACKUP_DIR/files.tar.gz" ] && HAS_FILES=1`,
    `[ -f "$BACKUP_DIR/database.sql.gz" ] && HAS_DB=1`,
    `if [ "$HAS_FILES" = "0" ] && [ "$HAS_DB" = "0" ]; then echo "OPS_RESTORE_ERROR=backup_empty"; exit 1; fi`,
    `test -d "$SITE_ROOT" || { echo "OPS_RESTORE_ERROR=site_root_missing"; exit 1; }`,
    wpPaths,
    wantFiles
      ? [
          `if [ "$HAS_FILES" = "1" ]; then`,
          `  echo "OPS_RESTORE_STEP=extracting_files"`,
          `  tar -xzf "$BACKUP_DIR/files.tar.gz" -C "$SITE_ROOT"`,
          `  echo "OPS_RESTORE_FILES=1"`,
          `elif [ "$RESTORE_MODE" = "files" ]; then`,
          `  echo "OPS_RESTORE_ERROR=mode_requires_files"; exit 1`,
          `fi`,
        ].join("\n")
      : `true`,
    wantWpContent
      ? [
          `if [ "$HAS_FILES" != "1" ]; then echo "OPS_RESTORE_ERROR=mode_requires_files"; exit 1; fi`,
          `echo "OPS_RESTORE_STEP=extracting_wp_content"`,
          `TMP_RESTORE=$(mktemp -d /tmp/ops-restore-XXXXXX)`,
          `tar -xzf "$BACKUP_DIR/files.tar.gz" -C "$TMP_RESTORE"`,
          `SRC_WC=""`,
          `if [ -d "$TMP_RESTORE/htdocs/wp-content" ]; then SRC_WC="$TMP_RESTORE/htdocs/wp-content"; fi`,
          `if [ -z "$SRC_WC" ] && [ -d "$TMP_RESTORE/wp-content" ]; then SRC_WC="$TMP_RESTORE/wp-content"; fi`,
          `if [ -z "$SRC_WC" ]; then SRC_WC=$(find "$TMP_RESTORE" -type d -name wp-content 2>/dev/null | head -1); fi`,
          `if [ -z "$SRC_WC" ] || [ ! -d "$SRC_WC" ]; then rm -rf "$TMP_RESTORE"; echo "OPS_RESTORE_ERROR=wp_content_not_found"; exit 1; fi`,
          `DEST_WC=""`,
          `if [ -n "$WP_ROOT" ] && [ -d "$WP_ROOT/wp-content" ]; then DEST_WC="$WP_ROOT/wp-content"; fi`,
          `if [ -z "$DEST_WC" ] && [ -d "$SITE_ROOT/htdocs/wp-content" ]; then DEST_WC="$SITE_ROOT/htdocs/wp-content"; fi`,
          `if [ -z "$DEST_WC" ]; then DEST_WC="$SITE_ROOT/htdocs/wp-content"; mkdir -p "$DEST_WC"; fi`,
          `rm -rf "$DEST_WC"`,
          `mkdir -p "$(dirname "$DEST_WC")"`,
          `cp -a "$SRC_WC" "$DEST_WC"`,
          `rm -rf "$TMP_RESTORE"`,
          `echo "OPS_RESTORE_FILES=1"`,
        ].join("\n")
      : `true`,
    wantDb
      ? [
          `if [ "$HAS_DB" = "1" ]; then`,
          `  if [ -z "$WP_ROOT" ]; then echo "OPS_RESTORE_ERROR=wordpress_required_for_db"; exit 1; fi`,
          `  echo "OPS_RESTORE_STEP=importing_database"`,
          `  gunzip -c "$BACKUP_DIR/database.sql.gz" | wp db import - --path="$WP_ROOT" --allow-root`,
          `  echo "OPS_RESTORE_DB=1"`,
          `elif [ "$RESTORE_MODE" = "db" ]; then`,
          `  echo "OPS_RESTORE_ERROR=mode_requires_database"; exit 1`,
          `fi`,
        ].join("\n")
      : `true`,
    `[ -n "$WP_ROOT" ] && chown -R www-data:www-data "$WP_ROOT" 2>/dev/null || true`,
    `echo "OPS_RESTORE_OK=1"`,
    `echo "OPS_RESTORE_PATH=$BACKUP_DIR"`,
    `echo "OPS_RESTORE_MODE=$RESTORE_MODE"`,
  ].join("\n");
}

export function siteRestoreProbe(
  domain: string,
  backupPath: string,
  mode: SiteRestoreMode = "full",
): readonly string[] {
  return ["bash", "-lc", buildSiteRestoreScript(domain, backupPath, mode)];
}

export function siteDeleteProbe(domain: string): readonly string[] {
  return ["bash", "-lc", buildSiteDeleteScript(domain)];
}

export function siteUpdateDomainProbe(oldDomain: string, newDomain: string): readonly string[] {
  return ["bash", "-lc", buildSiteUpdateDomainScript(oldDomain, newDomain)];
}

export type SiteCloneType = Exclude<SiteCreateType, "proxy" | "alias">;

export interface SiteCloneParams {
  sourceDomain: string;
  targetDomain: string;
  siteType: SiteCloneType;
  phpVersion?: "default" | "74" | "80" | "81" | "82" | "83" | "84";
  /** Se true, cria sem SSL (DNS de staging costuma não estar pronto). */
  asStaging?: boolean;
}

export interface ParsedSiteCloneOutput {
  ok: boolean;
  targetDomain?: string;
  sourceDomain?: string;
  isWordPress?: boolean;
  error?: string;
}

/**
 * Clone MVP: wo site create no destino + rsync de arquivos + dump/import DB com search-replace (WP).
 * Limitações: sem SSL automático no destino; proxy/alias não suportados; multisite/search-replace best-effort;
 * não copia crons externos nem configs Redis além do que está nos arquivos.
 */
export function buildSiteCloneScript(input: SiteCloneParams): string {
  const src = input.sourceDomain.toLowerCase();
  const dst = input.targetDomain.toLowerCase();
  if (!validateDomain(src) || !validateDomain(dst)) throw new Error("Domínio inválido");
  if (src === dst) throw new Error("Domínios de origem e destino iguais");

  const siteType = input.siteType;
  const typeFlag = TYPE_FLAGS[siteType] ?? "--html";
  const php =
    input.phpVersion && input.phpVersion !== "default" ? PHP_FLAGS[input.phpVersion] : null;
  const createFlags = [typeFlag, php].filter(Boolean).join(" ");
  const createCmd = woCmd(`site create ${shellQuote(dst)} ${createFlags}`);

  const isWp = /^wp/i.test(siteType);

  const rsyncExcludes = [
    "--exclude=htdocs/wp-content/cache",
    "--exclude=htdocs/wp-content/wflogs",
    "--exclude=htdocs/wp-content/uploads/wc-logs",
    "--exclude=htdocs/wp-content/ai1wm-backups",
    "--exclude=*.log",
  ].join(" ");

  const wpClone = isWp
    ? [
        `SRC_ROOT="/var/www/$SRC"`,
        `DST_ROOT="/var/www/$DST"`,
        `SRC_WP=""; DST_WP=""`,
        `if [ -f "$SRC_ROOT/htdocs/wp-load.php" ]; then SRC_WP="$SRC_ROOT/htdocs"; elif [ -f "$SRC_ROOT/wp-load.php" ]; then SRC_WP="$SRC_ROOT"; fi`,
        `if [ -f "$DST_ROOT/htdocs/wp-load.php" ]; then DST_WP="$DST_ROOT/htdocs"; elif [ -f "$DST_ROOT/wp-load.php" ]; then DST_WP="$DST_ROOT"; fi`,
        `test -n "$SRC_WP" || { echo "OPS_CLONE_ERROR=source_not_wordpress"; exit 1; }`,
        `test -n "$DST_WP" || { echo "OPS_CLONE_ERROR=target_not_wordpress"; exit 1; }`,
        `echo "OPS_CLONE_STEP=preserving_target_wpconfig"`,
        `CFG_BAK=$(mktemp /tmp/ops-clone-wpconfig-XXXXXX)`,
        `cp -a "$DST_WP/wp-config.php" "$CFG_BAK"`,
        `echo "OPS_CLONE_STEP=rsync_files"`,
        `rsync -a --delete ${rsyncExcludes} --exclude=wp-config.php "$SRC_WP/" "$DST_WP/" || { echo "OPS_CLONE_ERROR=rsync_failed"; exit 1; }`,
        `cp -a "$CFG_BAK" "$DST_WP/wp-config.php"`,
        `rm -f "$CFG_BAK"`,
        `echo "OPS_CLONE_STEP=export_source_db"`,
        `DUMP=$(mktemp /tmp/ops-clone-db-XXXXXX.sql)`,
        `wp db export "$DUMP" --path="$SRC_WP" --allow-root --single-transaction >/dev/null 2>&1 || { echo "OPS_CLONE_ERROR=db_export_failed"; rm -f "$DUMP"; exit 1; }`,
        `test -s "$DUMP" || { echo "OPS_CLONE_ERROR=db_export_empty"; rm -f "$DUMP"; exit 1; }`,
        `echo "OPS_CLONE_STEP=import_target_db"`,
        `wp db import "$DUMP" --path="$DST_WP" --allow-root || { echo "OPS_CLONE_ERROR=db_import_failed"; rm -f "$DUMP"; exit 1; }`,
        `rm -f "$DUMP"`,
        `echo "OPS_CLONE_STEP=search_replace"`,
        `wp search-replace "https://$SRC" "https://$DST" --path="$DST_WP" --all-tables --allow-root 2>/dev/null || true`,
        `wp search-replace "http://$SRC" "http://$DST" --path="$DST_WP" --all-tables --allow-root 2>/dev/null || true`,
        `wp search-replace "https://www.$SRC" "https://$DST" --path="$DST_WP" --all-tables --allow-root 2>/dev/null || true`,
        `wp search-replace "http://www.$SRC" "http://$DST" --path="$DST_WP" --all-tables --allow-root 2>/dev/null || true`,
        `wp search-replace "$SRC" "$DST" --path="$DST_WP" --all-tables --allow-root 2>/dev/null || true`,
        `wp option update blog_public 0 --path="$DST_WP" --allow-root 2>/dev/null || true`,
        `chown -R www-data:www-data "$DST_WP" 2>/dev/null || true`,
        `echo "OPS_CLONE_WP=1"`,
      ].join("\n")
    : [
        `SRC_ROOT="/var/www/$SRC"`,
        `DST_ROOT="/var/www/$DST"`,
        `echo "OPS_CLONE_STEP=rsync_files"`,
        `if [ -d "$SRC_ROOT/htdocs" ] && [ -d "$DST_ROOT/htdocs" ]; then`,
        `  rsync -a --delete ${rsyncExcludes} "$SRC_ROOT/htdocs/" "$DST_ROOT/htdocs/" || { echo "OPS_CLONE_ERROR=rsync_failed"; exit 1; }`,
        `  chown -R www-data:www-data "$DST_ROOT/htdocs" 2>/dev/null || true`,
        `else`,
        `  rsync -a --delete ${rsyncExcludes} --exclude=conf --exclude=logs "$SRC_ROOT/" "$DST_ROOT/" || { echo "OPS_CLONE_ERROR=rsync_failed"; exit 1; }`,
        `  chown -R www-data:www-data "$DST_ROOT" 2>/dev/null || true`,
        `fi`,
        `echo "OPS_CLONE_WP=0"`,
      ].join("\n");

  return [
    WO_PATH,
    `set -e`,
    `set -o pipefail`,
    `SRC=${shellQuote(src)}`,
    `DST=${shellQuote(dst)}`,
    `test -d "/var/www/$SRC" || { echo "OPS_CLONE_ERROR=source_missing"; exit 1; }`,
    `test ! -d "/var/www/$DST" || { echo "OPS_CLONE_ERROR=target_exists"; exit 1; }`,
    `echo "OPS_CLONE_STEP=create_target"`,
    `${createCmd} || { echo "OPS_CLONE_ERROR=site_create_failed"; exit 1; }`,
    `test -d "/var/www/$DST" || { echo "OPS_CLONE_ERROR=target_missing_after_create"; exit 1; }`,
    wpClone,
    `nginx -t >/dev/null 2>&1 && (${woCmd("stack reload --nginx")} 2>/dev/null || systemctl reload nginx 2>/dev/null || true) || true`,
    `echo "OPS_CLONE_OK=1"`,
    `echo "OPS_CLONE_SOURCE=$SRC"`,
    `echo "OPS_CLONE_TARGET=$DST"`,
  ].join("\n");
}

export function parseSiteCloneOutput(output: string): ParsedSiteCloneOutput {
  const text = stripAnsi(output).replace(/\r/g, "");
  const kv: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^OPS_CLONE_(OK|SOURCE|TARGET|WP|ERROR)=(.*)$/);
    if (m) kv[m[1]!] = m[2]!.trim();
  }
  if (kv.OK === "1" && kv.TARGET) {
    return {
      ok: true,
      targetDomain: kv.TARGET,
      sourceDomain: kv.SOURCE,
      isWordPress: kv.WP === "1",
    };
  }
  const err = kv.ERROR || matchOpsLine(text, "OPS_CLONE_ERROR");
  if (err) return { ok: false, error: humanizeCloneError(err) };
  const hint = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("OPS_CLONE_"))
    .slice(-6)
    .join(" | ")
    .slice(0, 220);
  return {
    ok: false,
    error: hint ? `Clone incompleto (${hint})` : "Clone incompleto ou não verificado",
  };
}

function humanizeCloneError(code: string): string {
  const map: Record<string, string> = {
    source_missing: "Site de origem não encontrado no servidor",
    target_exists: "O domínio de destino já existe no servidor",
    site_create_failed: "Falha ao criar o site de destino no WordOps",
    target_missing_after_create: "Site criado, mas o diretório de destino não apareceu",
    source_not_wordpress: "Origem não parece ser WordPress",
    target_not_wordpress: "Destino não parece ser WordPress após criação",
    rsync_failed: "Falha ao copiar arquivos (rsync)",
    db_export_failed: "Falha ao exportar o banco da origem",
    db_export_empty: "Dump do banco da origem veio vazio",
    db_import_failed: "Falha ao importar o banco no destino",
  };
  return map[code] ?? `Erro no clone: ${code}`;
}

export function estimateSiteCloneProgress(output: string): number {
  const text = stripAnsi(output).toLowerCase();
  if (/ops_clone_ok=1/.test(text)) return 95;
  if (/ops_clone_step=search_replace/.test(text)) return 80;
  if (/ops_clone_step=import_target_db/.test(text)) return 70;
  if (/ops_clone_step=export_source_db/.test(text)) return 55;
  if (/ops_clone_step=rsync_files/.test(text)) return 40;
  if (/ops_clone_step=preserving_target_wpconfig/.test(text)) return 30;
  if (/ops_clone_step=create_target/.test(text) || /installing wordpress/.test(text)) return 20;
  return 10;
}

export function siteCloneProbe(input: SiteCloneParams): readonly string[] {
  return ["bash", "-lc", buildSiteCloneScript(input)];
}

export function ftpUserCreateProbe(domain: string, username: string, password: string): readonly string[] {
  return ["bash", "-lc", buildFtpUserCreateScript(domain, username, password)];
}

export interface WpConfigDbCredentials {
  dbName: string;
  dbUser: string;
  dbPassword: string;
  dbHost: string;
  tablePrefix?: string;
}

export type WpMultisiteMode = "none" | "subdir" | "subdomain";

export interface WpConfigMultisiteInfo {
  mode: WpMultisiteMode;
  domainCurrentSite?: string;
  pathCurrentSite?: string;
}

/** Extrai credenciais MySQL de wp-config.php (conteúdo bruto). */
export function parseWpConfigDbCredentials(content: string): WpConfigDbCredentials | null {
  const define = (name: string): string | undefined => {
    const re = new RegExp(`define\\s*\\(\\s*['"]${name}['"]\\s*,\\s*['"]([^'"]*)['"]\\s*\\)`, "i");
    const m = content.match(re);
    return m?.[1];
  };
  const dbName = define("DB_NAME");
  const dbUser = define("DB_USER");
  const dbPassword = define("DB_PASSWORD");
  const dbHost = define("DB_HOST") ?? "localhost";
  if (!dbName || !dbUser || dbPassword === undefined) return null;
  const prefixMatch = content.match(/\$table_prefix\s*=\s*['"]([^'"]*)['"]/);
  return {
    dbName,
    dbUser,
    dbPassword,
    dbHost,
    tablePrefix: prefixMatch?.[1],
  };
}

/** Detecta Multisite (subpastas/subdomínios) no wp-config.php. */
export function parseWpConfigMultisite(content: string): WpConfigMultisiteInfo {
  const defineBool = (name: string): boolean | undefined => {
    const re = new RegExp(`define\\s*\\(\\s*['"]${name}['"]\\s*,\\s*(true|false)\\s*\\)`, "i");
    const m = content.match(re);
    if (!m?.[1]) return undefined;
    return m[1].toLowerCase() === "true";
  };
  const defineStr = (name: string): string | undefined => {
    const re = new RegExp(`define\\s*\\(\\s*['"]${name}['"]\\s*,\\s*['"]([^'"]*)['"]\\s*\\)`, "i");
    return content.match(re)?.[1];
  };

  if (defineBool("MULTISITE") !== true) {
    return { mode: "none" };
  }

  const subdomain = defineBool("SUBDOMAIN_INSTALL") === true;
  return {
    mode: subdomain ? "subdomain" : "subdir",
    domainCurrentSite: defineStr("DOMAIN_CURRENT_SITE")?.toLowerCase(),
    pathCurrentSite: defineStr("PATH_CURRENT_SITE") || "/",
  };
}

/** Hostname sem scheme/porta a partir de URL ou host puro. */
export function hostnameFromSiteUrl(urlOrHost: string): string | undefined {
  const raw = urlOrHost.trim();
  if (!raw) return undefined;
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    return new URL(withScheme).hostname.toLowerCase() || undefined;
  } catch {
    return undefined;
  }
}

export interface SiteMigrateRemoteDbParams {
  host: string;
  port?: number;
  name: string;
  user: string;
  password: string;
}

export interface SiteMigrateImportParams {
  domain: string;
  destDb: SiteDbCredentials;
  remoteDb?: SiteMigrateRemoteDbParams;
  sqlDumpPath?: string;
  oldUrl?: string;
  multisiteMode?: WpMultisiteMode;
  oldPath?: string;
}

export function buildSiteMigrateImportScript(params: SiteMigrateImportParams): string {
  const d = params.domain.toLowerCase();
  if (!validateDomain(d)) throw new Error("Domínio inválido");

  const destHost = shellQuote(params.destDb.host ?? "localhost");
  const destUser = shellQuote(params.destDb.user);
  const destPass = shellQuote(params.destDb.pass);
  const destName = shellQuote(params.destDb.name);

  const parts: string[] = [
    WO_PATH,
    `DOMAIN=${shellQuote(d)}`,
    `SITE_ROOT="/var/www/$DOMAIN"`,
    `WP_ROOT="$SITE_ROOT/htdocs"`,
    `test -d "$WP_ROOT" || WP_ROOT="$SITE_ROOT"`,
    `DUMP="/tmp/opspanel-migrate-$DOMAIN.sql"`,
    `NORMALIZED="/tmp/opspanel-migrate-$DOMAIN-mariadb.sql"`,
    `rm -f "$DUMP" "$NORMALIZED"`,
  ];

  if (params.sqlDumpPath) {
    parts.push(
      `test -f ${shellQuote(params.sqlDumpPath)} || { echo "OPS_MIGRATE_ERROR=sql_missing"; exit 1; }`,
      `cp ${shellQuote(params.sqlDumpPath)} "$DUMP"`,
    );
  } else if (params.remoteDb) {
    const rHost = shellQuote(params.remoteDb.host);
    const rPort = params.remoteDb.port ?? 3306;
    const rUser = shellQuote(params.remoteDb.user);
    const rPass = shellQuote(params.remoteDb.password);
    const rName = shellQuote(params.remoteDb.name);
    parts.push(
      // Flags só do MySQL oficial quebram o mysqldump do MariaDB (WordOps).
      `mysqldump --single-transaction --quick --lock-tables=false --default-character-set=utf8mb4 -h ${rHost} -P ${rPort} -u ${rUser} -p${rPass} ${rName} > "$DUMP" 2>/tmp/opspanel-mysqldump-$DOMAIN.err`,
      `test -s "$DUMP" || { echo "OPS_MIGRATE_ERROR=remote_dump_failed"; cat /tmp/opspanel-mysqldump-$DOMAIN.err 2>/dev/null | tail -c 400; exit 1; }`,
      `echo "OPS_MIGRATE_SOURCE=hosting_mysql"`,
    );
  } else {
    parts.push(`echo "OPS_MIGRATE_ERROR=no_db_source"; exit 1`);
  }

  parts.push(
    `sed -E -e 's/utf8mb4_0900_ai_ci/utf8mb4_unicode_ci/g' -e 's/utf8mb4_0900_as_ci/utf8mb4_unicode_ci/g' -e 's/utf8mb4_0900_as_cs/utf8mb4_unicode_ci/g' -e 's/DEFINER=[^[:space:]]*/DEFINER=CURRENT_USER/g' -e '/^SET @@GLOBAL/d' -e '/^SET @@SESSION/d' -e '/^SET NAMES utf8mb4/d' -e 's/ENGINE=MyISAM/ENGINE=InnoDB/g' "$DUMP" > "$NORMALIZED"`,
    `test -s "$NORMALIZED" || cp "$DUMP" "$NORMALIZED"`,
    `mysql -h ${destHost} -u ${destUser} -p${destPass} --default-character-set=utf8mb4 -e "SET SESSION sql_mode='NO_ENGINE_SUBSTITUTION';" ${destName}`,
    `mysql -h ${destHost} -u ${destUser} -p${destPass} --default-character-set=utf8mb4 ${destName} < "$NORMALIZED"`,
    `test $? -eq 0 || { echo "OPS_MIGRATE_ERROR=import_failed"; exit 1; }`,
    `rm -f "$DUMP" "$NORMALIZED"`,
    `echo "OPS_MIGRATE_DB_IMPORTED=1"`,
    `echo "OPS_MIGRATE_DB_ENGINE=mariadb"`,
  );

  if (params.oldUrl) {
    const oldU = shellQuote(params.oldUrl.replace(/\/$/, ""));
    const newHttps = shellQuote(`https://${d}`);
    const newHttp = shellQuote(`http://${d}`);
    const oldHost = hostnameFromSiteUrl(params.oldUrl);
    const srParts = [
      `wp search-replace ${oldU} ${newHttps} --path="$WP_ROOT" --all-tables --allow-root 2>/dev/null || true`,
      `wp search-replace ${oldU} ${newHttp} --path="$WP_ROOT" --all-tables --allow-root 2>/dev/null || true`,
    ];
    if (oldHost && oldHost !== d) {
      srParts.push(
        `wp search-replace ${shellQuote(oldHost)} ${shellQuote(d)} --path="$WP_ROOT" --all-tables --allow-root 2>/dev/null || true`,
      );
    }
    if (params.multisiteMode === "subdir" || params.multisiteMode === "subdomain") {
      srParts.push(`echo "OPS_MIGRATE_MULTISITE_URLS=1"`);
    }
    parts.push(
      `if [ -f "$WP_ROOT/wp-config.php" ]; then ${srParts.join("; ")}; fi`,
    );
  }

  parts.push(`echo "OPS_MIGRATE_OK=1"`);
  return parts.join("\n");
}

export function buildSiteMigrateSearchReplaceScript(
  domain: string,
  oldUrl: string,
  options?: { multisiteMode?: WpMultisiteMode; oldPath?: string },
): string {
  const d = domain.toLowerCase();
  if (!validateDomain(d)) throw new Error("Domínio inválido");
  const old = oldUrl.replace(/\/$/, "");
  const oldQ = shellQuote(old);
  const httpsQ = shellQuote(`https://${d}`);
  const httpQ = shellQuote(`http://${d}`);
  const oldHost = hostnameFromSiteUrl(oldUrl) ?? hostnameFromSiteUrl(old);
  const multisite = options?.multisiteMode === "subdir" || options?.multisiteMode === "subdomain";

  const parts = [
    WO_PATH,
    `DOMAIN=${shellQuote(d)}`,
    `WP_ROOT="/var/www/$DOMAIN/htdocs"`,
    `test -d "$WP_ROOT" || WP_ROOT="/var/www/$DOMAIN"`,
    `test -f "$WP_ROOT/wp-config.php" || { echo "OPS_MIGRATE_ERROR=not_wordpress"; exit 1; }`,
    `wp search-replace ${oldQ} ${httpsQ} --path="$WP_ROOT" --all-tables --allow-root 2>/dev/null || true`,
    `wp search-replace ${oldQ} ${httpQ} --path="$WP_ROOT" --all-tables --allow-root 2>/dev/null || true`,
  ];

  if (oldHost && oldHost !== d) {
    parts.push(
      `wp search-replace ${shellQuote(`https://${oldHost}`)} ${httpsQ} --path="$WP_ROOT" --all-tables --allow-root 2>/dev/null || true`,
      `wp search-replace ${shellQuote(`http://${oldHost}`)} ${httpsQ} --path="$WP_ROOT" --all-tables --allow-root 2>/dev/null || true`,
      `wp search-replace ${shellQuote(oldHost)} ${shellQuote(d)} --path="$WP_ROOT" --all-tables --allow-root 2>/dev/null || true`,
    );
    if (oldHost.startsWith("www.")) {
      const bare = oldHost.slice(4);
      if (bare && bare !== d) {
        parts.push(
          `wp search-replace ${shellQuote(bare)} ${shellQuote(d)} --path="$WP_ROOT" --all-tables --allow-root 2>/dev/null || true`,
        );
      }
    } else {
      parts.push(
        `wp search-replace ${shellQuote(`www.${oldHost}`)} ${shellQuote(d)} --path="$WP_ROOT" --all-tables --allow-root 2>/dev/null || true`,
      );
    }
  }

  if (multisite) {
    const oldPath = (options?.oldPath || "/").trim() || "/";
    parts.push(
      `wp search-replace ${shellQuote(`https://www.${d}`)} ${httpsQ} --path="$WP_ROOT" --all-tables --allow-root 2>/dev/null || true`,
      `wp rewrite flush --network --path="$WP_ROOT" --allow-root 2>/dev/null || true`,
      `echo "OPS_MIGRATE_MULTISITE_URLS=1"`,
    );
    if (oldPath !== "/" && oldPath !== "") {
      // Paths em wp_blogs / PATH_CURRENT_SITE: ex. /blog/ → /
      parts.push(
        `wp search-replace ${shellQuote(oldPath)} ${shellQuote("/")} --path="$WP_ROOT" --all-tables --precise --allow-root 2>/dev/null || true`,
      );
    }
  }

  parts.push(`echo "OPS_MIGRATE_URLS_UPDATED=1"`);
  return parts.join("; ");
}

export function siteMigrateImportProbe(params: SiteMigrateImportParams): readonly string[] {
  return ["bash", "-lc", buildSiteMigrateImportScript(params)];
}

export interface SiteMigrateOriginPhpDumpParams {
  domain: string;
  ftp: {
    protocol: "ftp" | "ftps" | "sftp";
    host: string;
    port?: number;
    username: string;
    password: string;
  };
  remoteDb: SiteMigrateRemoteDbParams;
  httpHost?: string;
}

/**
 * Fallback quando Remote MySQL bloqueia o VPS: PHP temporário via FTP na origem,
 * dump local na hospedagem, download para /tmp no WordOps.
 */
export function buildSiteMigrateOriginPhpDumpScript(params: SiteMigrateOriginPhpDumpParams): string {
  const d = params.domain.toLowerCase();
  if (!validateDomain(d)) throw new Error("Domínio inválido");
  if (params.ftp.protocol === "sftp") {
    throw new Error("Fallback PHP via FTP não disponível para SFTP");
  }

  const token = `op${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const phpName = `opspanel-dump-${token}.php`;
  const sqlName = `opspanel-dump-${token}.sql`;
  const userB64 = Buffer.from(params.remoteDb.user, "utf8").toString("base64");
  const passB64 = Buffer.from(params.remoteDb.password, "utf8").toString("base64");
  const nameB64 = Buffer.from(params.remoteDb.name, "utf8").toString("base64");
  const ftpUser = shellQuote(params.ftp.username);
  const ftpPass = shellQuote(params.ftp.password);
  const ftpPort = params.ftp.port ?? 21;
  const httpHostHeader = (params.httpHost || d).toLowerCase();
  const scheme = params.ftp.protocol === "ftps" ? "ftps" : "ftp";
  const ftpOpen = `${scheme}://${params.ftp.host}:${ftpPort}`;

  return [
    WO_PATH,
    `DOMAIN=${shellQuote(d)}`,
    `TOKEN=${shellQuote(token)}`,
    `PHP_NAME=${shellQuote(phpName)}`,
    `SQL_NAME=${shellQuote(sqlName)}`,
    `DUMP="/tmp/opspanel-migrate-$DOMAIN.sql"`,
    `rm -f "$DUMP"`,
    `cat > "/tmp/$PHP_NAME" <<'PHPEOF'`,
    `<?php`,
    `if (!isset($_GET['t']) || $_GET['t'] !== '${token}') { http_response_code(403); exit('forbidden'); }`,
    `@set_time_limit(0);`,
    `$out = __DIR__ . '/${sqlName}';`,
    `$user = base64_decode('${userB64}');`,
    `$pass = base64_decode('${passB64}');`,
    `$db = base64_decode('${nameB64}');`,
    `$mysqli = @new mysqli('localhost', $user, $pass, $db);`,
    `if ($mysqli->connect_error) { http_response_code(500); echo 'connect: '.$mysqli->connect_error; exit; }`,
    `$mysqli->set_charset('utf8mb4');`,
    `$fh = fopen($out, 'w');`,
    `if (!$fh) { http_response_code(500); echo 'cannot write'; exit; }`,
    `fwrite($fh, "-- opspanel dump\\nSET NAMES utf8mb4;\\nSET FOREIGN_KEY_CHECKS=0;\\n");`,
    `$tables = array();`,
    `$res = $mysqli->query('SHOW TABLES');`,
    `while ($row = $res->fetch_array()) { $tables[] = $row[0]; }`,
    `foreach ($tables as $table) {`,
    `  $createRes = $mysqli->query('SHOW CREATE TABLE \`' . $table . '\`');`,
    `  $create = $createRes->fetch_assoc();`,
    `  fwrite($fh, "\\nDROP TABLE IF EXISTS \`" . $table . "\`;\\n" . $create['Create Table'] . ";\\n");`,
    `  $data = $mysqli->query('SELECT * FROM \`' . $table . '\`', MYSQLI_USE_RESULT);`,
    `  while ($r = $data->fetch_assoc()) {`,
    `    $cols = array(); $vals = array();`,
    `    foreach ($r as $c => $v) {`,
    `      $cols[] = '\`' . $c . '\`';`,
    `      if ($v === null) { $vals[] = 'NULL'; }`,
    `      else { $vals[] = "'" . $mysqli->real_escape_string($v) . "'"; }`,
    `    }`,
    `    fwrite($fh, 'INSERT INTO \`' . $table . '\` (' . implode(',', $cols) . ') VALUES (' . implode(',', $vals) . ');' . "\\n");`,
    `  }`,
    `  $data->free();`,
    `}`,
    `fwrite($fh, "SET FOREIGN_KEY_CHECKS=1;\\n");`,
    `fclose($fh);`,
    `header('Content-Type: text/plain');`,
    `echo 'ok='.filesize($out).' tables='.count($tables);`,
    `PHPEOF`,
    `command -v lftp >/dev/null || { echo "OPS_MIGRATE_ERROR=lftp_missing"; exit 1; }`,
    `lftp -u ${ftpUser},${ftpPass} -e "set ssl:verify-certificate no; set ftp:passive-mode true; put /tmp/$PHP_NAME -o public_html/$PHP_NAME; put /tmp/$PHP_NAME -o $PHP_NAME; put /tmp/$PHP_NAME -o www/$PHP_NAME; bye" ${ftpOpen} || { echo "OPS_MIGRATE_ERROR=ftp_upload_php_failed"; exit 1; }`,
    `TRIGGER_OK=0`,
    `for URL in "https://${httpHostHeader}/$PHP_NAME?t=$TOKEN" "http://${httpHostHeader}/$PHP_NAME?t=$TOKEN" "http://${params.ftp.host}/$PHP_NAME?t=$TOKEN" "http://${params.ftp.host}/public_html/$PHP_NAME?t=$TOKEN"; do`,
    `  RESP=$(curl -skS -L -H "Host: ${httpHostHeader}" --max-time 900 "$URL" 2>/dev/null || true)`,
    `  echo "OPS_MIGRATE_PHP_TRIGGER=$RESP"`,
    `  case "$RESP" in ok=*) TRIGGER_OK=1; break ;; esac`,
    `done`,
    `test "$TRIGGER_OK" = "1" || { echo "OPS_MIGRATE_ERROR=origin_php_dump_failed"; lftp -u ${ftpUser},${ftpPass} -e "set ssl:verify-certificate no; rm -f public_html/$PHP_NAME; rm -f /$PHP_NAME; rm -f www/$PHP_NAME; bye" ${ftpOpen} 2>/dev/null || true; exit 1; }`,
    `lftp -u ${ftpUser},${ftpPass} -e "set ssl:verify-certificate no; set ftp:passive-mode true; get public_html/$SQL_NAME -o $DUMP; get $SQL_NAME -o $DUMP; get www/$SQL_NAME -o $DUMP; rm -f public_html/$PHP_NAME; rm -f /$PHP_NAME; rm -f www/$PHP_NAME; rm -f public_html/$SQL_NAME; rm -f /$SQL_NAME; rm -f www/$SQL_NAME; bye" ${ftpOpen} || { echo "OPS_MIGRATE_ERROR=ftp_download_sql_failed"; exit 1; }`,
    `test -s "$DUMP" || { echo "OPS_MIGRATE_ERROR=sql_empty"; exit 1; }`,
    `echo "OPS_MIGRATE_FTP_PHP_DUMP_OK=1"`,
    `echo "OPS_MIGRATE_SQL_PATH=$DUMP"`,
    `echo "OPS_MIGRATE_SQL_BYTES=$(wc -c < "$DUMP")"`,
  ].join("\n");
}

export function siteMigrateOriginPhpDumpProbe(params: SiteMigrateOriginPhpDumpParams): readonly string[] {
  return ["bash", "-lc", buildSiteMigrateOriginPhpDumpScript(params)];
}

/** Confere se o prefixo do wp-config tem tabelas reais (evita “sucesso” sem banco). */
export function buildSiteMigrateDbHealthScript(domain: string): string {
  const d = domain.toLowerCase();
  if (!validateDomain(d)) throw new Error("Domínio inválido");
  return [
    WO_PATH,
    `DOMAIN=${shellQuote(d)}`,
    `WP_ROOT="/var/www/$DOMAIN/htdocs"`,
    `test -d "$WP_ROOT" || WP_ROOT="/var/www/$DOMAIN"`,
    `test -f "$WP_ROOT/wp-config.php" || { echo "OPS_MIGRATE_ERROR=wp_config_missing"; exit 1; }`,
    `PREFIX=$(wp config get table_prefix --path="$WP_ROOT" --allow-root 2>/dev/null || echo wp_)`,
    `PREFIX=\${PREFIX:-wp_}`,
    `COUNT=$(wp db query "SHOW TABLES LIKE '\${PREFIX}%'" --path="$WP_ROOT" --allow-root --skip-column-names 2>/dev/null | wc -l | tr -d ' ')`,
    `echo "OPS_MIGRATE_DB_PREFIX=$PREFIX"`,
    `echo "OPS_MIGRATE_DB_TABLES=$COUNT"`,
    `test "\${COUNT:-0}" -ge 5 || { echo "OPS_MIGRATE_ERROR=db_tables_missing"; exit 1; }`,
    `BODY=$(curl -skS -H "Host: $DOMAIN" --max-time 20 "https://127.0.0.1/" 2>/dev/null || curl -sS -H "Host: $DOMAIN" --max-time 20 "http://127.0.0.1/" 2>/dev/null || true)`,
    `if echo "$BODY" | grep -qi "Error establishing a database connection\\|Database Error"; then echo "OPS_MIGRATE_ERROR=http_database_error"; exit 1; fi`,
    `echo "OPS_MIGRATE_DB_HEALTH_OK=1"`,
  ].join("\n");
}

export function siteMigrateDbHealthProbe(domain: string): readonly string[] {
  return ["bash", "-lc", buildSiteMigrateDbHealthScript(domain)];
}

/** Após espelhar arquivos: aponta wp-config para o MariaDB do WordOps e remove auto_prepend da hospedagem antiga. */
export function buildSiteMigrateFinalizeScript(params: {
  domain: string;
  destDb: SiteDbCredentials;
  multisiteMode?: WpMultisiteMode;
  pathCurrentSite?: string;
}): string {
  const d = params.domain.toLowerCase();
  if (!validateDomain(d)) throw new Error("Domínio inválido");
  const dbName = shellQuote(params.destDb.name);
  const dbUser = shellQuote(params.destDb.user);
  const dbPass = shellQuote(params.destDb.pass);
  const dbHost = shellQuote(params.destDb.host ?? "localhost");
  const multisiteMode = params.multisiteMode ?? "none";
  const pathCurrent = (params.pathCurrentSite || "/").trim() || "/";

  const parts = [
    WO_PATH,
    `DOMAIN=${shellQuote(d)}`,
    `WP_ROOT="/var/www/$DOMAIN/htdocs"`,
    `test -d "$WP_ROOT" || WP_ROOT="/var/www/$DOMAIN"`,
    `CFG="$WP_ROOT/wp-config.php"`,
    `test -f "$CFG" || { echo "OPS_MIGRATE_ERROR=wp_config_missing"; exit 1; }`,
    `cp -a "$CFG" "$CFG.bak-opspanel" 2>/dev/null || true`,
    `wp config set DB_NAME ${dbName} --path="$WP_ROOT" --allow-root`,
    `wp config set DB_USER ${dbUser} --path="$WP_ROOT" --allow-root`,
    `wp config set DB_PASSWORD ${dbPass} --path="$WP_ROOT" --allow-root`,
    `wp config set DB_HOST ${dbHost} --path="$WP_ROOT" --allow-root`,
    `echo "OPS_MIGRATE_WPCONFIG=1"`,
  ];

  if (multisiteMode === "subdir" || multisiteMode === "subdomain") {
    const subdomainInstall = multisiteMode === "subdomain" ? "true" : "false";
    parts.push(
      `wp config set MULTISITE true --raw --path="$WP_ROOT" --allow-root`,
      `wp config set SUBDOMAIN_INSTALL ${subdomainInstall} --raw --path="$WP_ROOT" --allow-root`,
      `wp config set DOMAIN_CURRENT_SITE ${shellQuote(d)} --path="$WP_ROOT" --allow-root`,
      `wp config set PATH_CURRENT_SITE ${shellQuote(pathCurrent)} --path="$WP_ROOT" --allow-root`,
      `wp config set SITE_ID_CURRENT_SITE 1 --raw --path="$WP_ROOT" --allow-root`,
      `wp config set BLOG_ID_CURRENT_SITE 1 --raw --path="$WP_ROOT" --allow-root`,
      // Cookie domain false é o padrão seguro para Multisite em subpastas no WordOps
      multisiteMode === "subdir"
        ? `wp config set COOKIE_DOMAIN false --raw --path="$WP_ROOT" --allow-root 2>/dev/null || true`
        : `true`,
      `echo "OPS_MIGRATE_MULTISITE=${multisiteMode}"`,
    );
  }

  parts.push(
    `if [ -f "$WP_ROOT/.user.ini" ]; then sed -i -E 's/^([[:space:]]*auto_prepend_file[[:space:]]*=.*)/; opspanel-disabled \\1/' "$WP_ROOT/.user.ini"; echo "OPS_MIGRATE_USERINI=1"; fi`,
    `if [ -f "$WP_ROOT/.htaccess" ]; then sed -i -E 's/^[[:space:]]*php_value[[:space:]]+auto_prepend_file.*/# opspanel-disabled auto_prepend/' "$WP_ROOT/.htaccess"; fi`,
    // Drop-ins/cache da hospedagem antiga quebram open_basedir no WordOps
    `if [ -f "$WP_ROOT/wp-content/advanced-cache.php" ]; then mv -f "$WP_ROOT/wp-content/advanced-cache.php" "$WP_ROOT/wp-content/advanced-cache.php.bak-opspanel" 2>/dev/null || rm -f "$WP_ROOT/wp-content/advanced-cache.php"; echo "OPS_MIGRATE_ADVANCED_CACHE=1"; fi`,
    `if [ -f "$WP_ROOT/wp-content/object-cache.php" ]; then mv -f "$WP_ROOT/wp-content/object-cache.php" "$WP_ROOT/wp-content/object-cache.php.bak-opspanel" 2>/dev/null || true; fi`,
    `wp config delete WPCACHEHOME --path="$WP_ROOT" --allow-root 2>/dev/null || true`,
    `wp config set WP_CACHE false --raw --path="$WP_ROOT" --allow-root 2>/dev/null || true`,
    `rm -f "$WP_ROOT/.maintenance"`,
    `chown -R www-data:www-data "$WP_ROOT" 2>/dev/null || true`,
    `echo "OPS_MIGRATE_FINALIZE_OK=1"`,
  );

  return parts.join("; ");
}

export function siteMigrateFinalizeProbe(params: {
  domain: string;
  destDb: SiteDbCredentials;
  multisiteMode?: WpMultisiteMode;
  pathCurrentSite?: string;
}): readonly string[] {
  return ["bash", "-lc", buildSiteMigrateFinalizeScript(params)];
}

export function siteMigrateSearchReplaceProbe(
  domain: string,
  oldUrl: string,
  options?: { multisiteMode?: WpMultisiteMode; oldPath?: string },
): readonly string[] {
  return ["bash", "-lc", buildSiteMigrateSearchReplaceScript(domain, oldUrl, options)];
}

export function buildSiteMigratePrepareWebrootScript(domain: string, webroot?: string): string {
  const d = domain.toLowerCase();
  if (!validateDomain(d)) throw new Error("Domínio inválido");

  if (webroot) {
    const target = shellQuote(webroot);
    return [
      WO_PATH,
      `TARGET=${target}`,
      `mkdir -p "$TARGET"`,
      `test -d "$TARGET" || { echo "OPS_MIGRATE_ERROR=webroot_missing"; exit 1; }`,
      `find "$TARGET" -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} + 2>/dev/null || true`,
      `echo "OPS_MIGRATE_WEBROOT=$TARGET"`,
      `echo "OPS_MIGRATE_OK=1"`,
    ].join("; ");
  }

  return [
    WO_PATH,
    `DOMAIN=${shellQuote(d)}`,
    `ROOT="/var/www/$DOMAIN"`,
    `test -d "$ROOT" || { echo "OPS_MIGRATE_ERROR=site_root_missing"; exit 1; }`,
    `if [ -d "$ROOT/htdocs" ] || [ -f "$ROOT/htdocs/index.php" ]; then TARGET="$ROOT/htdocs"; elif [ -d "$ROOT/htdocs" ]; then TARGET="$ROOT/htdocs"; else mkdir -p "$ROOT/htdocs"; TARGET="$ROOT/htdocs"; fi`,
    `mkdir -p "$TARGET"`,
    `find "$TARGET" -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} + 2>/dev/null || true`,
    `echo "OPS_MIGRATE_WEBROOT=$TARGET"`,
    `echo "OPS_MIGRATE_OK=1"`,
  ].join("; ");
}

export function siteMigratePrepareWebrootProbe(domain: string, webroot?: string): readonly string[] {
  return ["bash", "-lc", buildSiteMigratePrepareWebrootScript(domain, webroot)];
}

export interface SiteMigrateFtpMirrorParams {
  protocol: "ftp" | "ftps" | "sftp";
  host: string;
  port?: number;
  username: string;
  password: string;
  sourcePath: string;
  destWebroot: string;
}

/**
 * Espelha a origem FTP/SFTP no webroot do WordOps usando lftp no próprio servidor destino.
 * Evita transferir dezenas de milhares de arquivos um a um pelo worker.
 *
 * Nota: não usar `lftp -f script URL` — o lftp rejeita `-f` junto com argumento de open.
 * Credenciais vão em `-u` (senha com `#` quebraria comentário se estivesse no script).
 */
export function buildSiteMigrateFtpMirrorScript(params: SiteMigrateFtpMirrorParams): string {
  const protocol = params.protocol === "ftps" ? "ftps" : params.protocol === "sftp" ? "sftp" : "ftp";
  const port = params.port ?? (protocol === "sftp" ? 22 : 21);
  const sourcePath = (params.sourcePath || "/").trim() || "/";
  const dest = params.destWebroot.replace(/\/+$/, "");
  const remoteUrl = `${protocol}://${params.host}:${port}`;

  const lftpCmds = [
    "set cmd:fail-exit no",
    "set net:max-retries 5",
    "set net:reconnect-interval-base 5",
    "set net:timeout 30",
    "set ftp:passive-mode true",
    `set ftp:ssl-allow ${protocol === "ftps" ? "yes" : "no"}`,
    `set ftp:ssl-force ${protocol === "ftps" ? "yes" : "no"}`,
    "set ssl:verify-certificate no",
    "set sftp:auto-confirm yes",
    `cd ${sourcePath}`,
    "lcd .",
    "mirror --verbose --parallel=4 --no-perms --no-umask --exclude-glob .ftpquota --exclude-glob .DS_Store",
    "bye",
  ].join("; ");

  return [
    `set -e`,
    `export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH`,
    `TARGET=${shellQuote(dest)}`,
    `mkdir -p "$TARGET"`,
    `command -v lftp >/dev/null 2>&1 || (export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y -qq lftp)`,
    `command -v lftp >/dev/null 2>&1 || { echo "OPS_MIGRATE_ERROR=lftp_missing"; exit 1; }`,
    `echo "OPS_MIGRATE_MIRROR_START=1"`,
    `cd "$TARGET"`,
    `set +e`,
    `lftp -u ${shellQuote(params.username)},${shellQuote(params.password)} -e ${shellQuote(lftpCmds)} ${shellQuote(remoteUrl)}`,
    `LFTP_RC=$?`,
    `set -e`,
    `COUNT=$(find "$TARGET" -type f 2>/dev/null | wc -l | tr -d ' ')`,
    `echo "OPS_MIGRATE_LFTP_RC=$LFTP_RC"`,
    `if [ "$COUNT" -le 5 ]; then echo "OPS_MIGRATE_ERROR=mirror_empty_rc_$LFTP_RC"; exit 1; fi`,
    `if [ "$LFTP_RC" -ne 0 ] && [ ! -f "$TARGET/wp-config.php" ] && [ ! -f "$TARGET/wp-load.php" ] && [ ! -f "$TARGET/index.php" ]; then echo "OPS_MIGRATE_ERROR=lftp_failed_$LFTP_RC"; exit 1; fi`,
    `if [ -f "$TARGET/wp-config.php" ] || [ -f "$TARGET/wp-load.php" ] || [ -f "$TARGET/index.php" ]; then echo "OPS_MIGRATE_MIRROR_SITE=1"; fi`,
    `echo "OPS_MIGRATE_MIRROR_FILES=$COUNT"`,
    `echo "OPS_MIGRATE_OK=1"`,
  ].join("; ");
}

export function siteMigrateFtpMirrorProbe(params: SiteMigrateFtpMirrorParams): readonly string[] {
  return ["bash", "-lc", buildSiteMigrateFtpMirrorScript(params)];
}

export function parseSiteMigrateMirrorOutput(output: string): { ok: boolean; fileCount?: number; error?: string } {
  const text = stripAnsi(output).replace(/\r/g, "");
  const err = text.match(/OPS_MIGRATE_ERROR=([^\n]+)/);
  if (err) return { ok: false, error: err[1]!.trim() };
  const count = text.match(/OPS_MIGRATE_MIRROR_FILES=(\d+)/);
  if (/OPS_MIGRATE_OK=1/.test(text) && count) {
    return { ok: true, fileCount: Number.parseInt(count[1]!, 10) };
  }
  return { ok: false, error: "Espelhamento FTP incompleto" };
}

export function parseSiteMigratePrepareOutput(output: string): { ok: boolean; webroot?: string; error?: string } {
  const text = stripAnsi(output).replace(/\r/g, "");
  const kv: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/OPS_MIGRATE_(OK|WEBROOT|ERROR)=(.*)$/);
    if (m) kv[m[1]!] = m[2]!.trim();
  }
  if (kv.ERROR) return { ok: false, error: kv.ERROR };
  if (kv.OK === "1" && kv.WEBROOT) return { ok: true, webroot: kv.WEBROOT };
  return { ok: false, error: "Preparação do webroot incompleta" };
}
