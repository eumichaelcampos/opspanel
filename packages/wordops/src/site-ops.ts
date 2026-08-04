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
  phpVersion?: "default" | "74" | "80" | "81" | "82" | "83";
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
};

const SSL_FLAGS: Record<string, string[]> = {
  none: [],
  letsencrypt: ["--letsencrypt"],
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
  return `${WO_PATH}; ${cf}${woCmd(`site create ${shellQuote(domain)} ${flags.join(" ")}`)}`;
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
      return `${WO_PATH}; ${woCmd(`site update ${shellQuote(d)} --letsencrypt`)}`;
    case "letsencrypt_dns_cf":
      return `${WO_PATH}; ${cf}${woCmd(`site update ${shellQuote(d)} --letsencrypt --dns=dns_cf`)}`;
    case "delete":
      return `${WO_PATH}; ${woCmd(`site delete ${shellQuote(d)} --no-prompt`)}`;
    default: {
      const upd = UPDATE_FLAGS[action];
      if (!upd) throw new Error("Ação não suportada");
      return `${WO_PATH}; ${woCmd(`site update ${shellQuote(d)} ${upd.join(" ")}`)}`;
    }
  }
}

export function buildSiteInfoScript(domain: string): string {
  const d = domain.toLowerCase();
  if (!validateDomain(d)) throw new Error("Domínio inválido");
  return `${WO_PATH}; ${woCmd(`site info ${shellQuote(d)}`)}`;
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

function applySiteInfoKey(info: ParsedSiteInfo, key: string, val: string): void {
  const k = key.toLowerCase().replace(/\s+/g, "_");

  if (k === "nginx_configuration" || (k.includes("nginx") && k.includes("config"))) {
    info.nginxConfig = val;
    if (/\(enabled\)/i.test(val)) info.isEnabled = true;
    if (/\(disabled\)/i.test(val)) info.isEnabled = false;
    const typeMatch = val.match(/\b(wpfc|wpredis|wprocket|wpsc|wpce|wp|html|php|mysql|proxy|alias)\b/i);
    if (typeMatch) info.siteType = typeMatch[1]!.toLowerCase();
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

export function parseSiteBackupOutput(output: string): ParsedSiteBackupOutput {
  const text = stripAnsi(output);
  const err = text.match(/OPS_BACKUP_ERROR=([^\n]+)/);
  if (err) return { ok: false, error: err[1]!.trim() };

  const kv: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^OPS_BACKUP_(OK|PATH|FILES|DB)=(.+)$/);
    if (m) kv[m[1]!] = m[2]!.trim();
  }
  if (kv.OK === "1" && kv.PATH && kv.FILES) {
    return {
      ok: true,
      backupPath: kv.PATH,
      filesArchive: kv.FILES,
      databaseArchive: kv.DB || undefined,
    };
  }
  return { ok: false, error: "Backup incompleto ou não verificado" };
}

export function buildSiteBackupScript(domain: string, db?: SiteDbCredentials): string {
  const d = domain.toLowerCase();
  if (!validateDomain(d)) throw new Error("Domínio inválido");

  const dbExport = db
    ? [
        `mysqldump --single-transaction --quick --lock-tables=false -h ${shellQuote(db.host ?? "localhost")} -u ${shellQuote(db.user)} -p${shellQuote(db.pass)} ${shellQuote(db.name)} > "$BACKUP_DIR/database.sql" 2>/dev/null`,
        `test -s "$BACKUP_DIR/database.sql" || { echo "OPS_BACKUP_ERROR=db_export_failed"; exit 1; }`,
        `gzip -f "$BACKUP_DIR/database.sql"`,
        `echo "OPS_BACKUP_DB=$BACKUP_DIR/database.sql.gz"`,
      ].join("; ")
    : [
        `if [ -f "$SITE_ROOT/wp-config.php" ]; then WP_ROOT="$SITE_ROOT"; elif [ -f "$SITE_ROOT/htdocs/wp-config.php" ]; then WP_ROOT="$SITE_ROOT/htdocs"; fi`,
        `if [ -n "$WP_ROOT" ]; then (cd "$WP_ROOT" && wp db export "$BACKUP_DIR/database.sql" --allow-root --single-transaction 2>/dev/null) && gzip -f "$BACKUP_DIR/database.sql" && echo "OPS_BACKUP_DB=$BACKUP_DIR/database.sql.gz"; fi`,
      ].join("; ");

  return [
    WO_PATH,
    `DOMAIN=${shellQuote(d)}`,
    `TS=$(date +%Y%m%d%H%M%S)`,
    `BACKUP_DIR="/var/backups/opspanel/${d}/$TS"`,
    `SITE_ROOT="/var/www/${d}"`,
    `mkdir -p "$BACKUP_DIR"`,
    `test -d "$SITE_ROOT" || { echo "OPS_BACKUP_ERROR=site_root_missing"; exit 1; }`,
    `tar -czf "$BACKUP_DIR/files.tar.gz" -C "$SITE_ROOT" .`,
    `test -s "$BACKUP_DIR/files.tar.gz" || { echo "OPS_BACKUP_ERROR=files_archive_failed"; exit 1; }`,
    `echo "OPS_BACKUP_FILES=$BACKUP_DIR/files.tar.gz"`,
    dbExport,
    `if [ -f "$SITE_ROOT/wp-config.php" ] || [ -f "$SITE_ROOT/htdocs/wp-config.php" ]; then test -f "$BACKUP_DIR/database.sql.gz" || { echo "OPS_BACKUP_ERROR=wordpress_db_required"; exit 1; }; fi`,
    `echo "OPS_BACKUP_OK=1"`,
    `echo "OPS_BACKUP_PATH=$BACKUP_DIR"`,
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

export function siteBackupProbe(domain: string, db?: SiteDbCredentials): readonly string[] {
  return ["bash", "-lc", buildSiteBackupScript(domain, db)];
}

export function siteDeleteProbe(domain: string): readonly string[] {
  return ["bash", "-lc", buildSiteDeleteScript(domain)];
}

export function siteUpdateDomainProbe(oldDomain: string, newDomain: string): readonly string[] {
  return ["bash", "-lc", buildSiteUpdateDomainScript(oldDomain, newDomain)];
}

export function ftpUserCreateProbe(domain: string, username: string, password: string): readonly string[] {
  return ["bash", "-lc", buildFtpUserCreateScript(domain, username, password)];
}
