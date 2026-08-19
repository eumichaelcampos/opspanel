import { describe, expect, it } from "vitest";
import {
  buildSiteBackupScript,
  buildSiteCreateScript,
  buildSiteMigrateFinalizeScript,
  buildSiteMigrateSearchReplaceScript,
  buildSiteRestoreScript,
  buildSiteWpAutologinScript,
  parseSiteBackupListOutput,
  parseSiteBackupOutput,
  parseSiteRestoreOutput,
  parseSiteInfoOutput,
  parseSiteWpAutologinOutput,
  parseWpConfigMultisite,
} from "./site-ops.js";

describe("buildSiteBackupScript", () => {
  it("detects WordPress root via wp-load.php in htdocs", () => {
    const script = buildSiteBackupScript("exemplo.com.br");
    expect(script).toContain("$SITE_ROOT/htdocs/wp-load.php");
    expect(script).toContain('wp db export "$BACKUP_DIR/database.sql" --path="$WP_ROOT"');
    expect(script).toContain("wp config get DB_NAME");
    expect(script).toContain("set +e");
    expect(script).toContain("TAR_RC=$?");
    expect(script).toContain("--exclude='./htdocs/wp-content/wflogs'");
    expect(script).toContain("exit 0");
    expect(script).not.toContain('if [ -f "$SITE_ROOT/wp-config.php" ]; then WP_ROOT="$SITE_ROOT"');
  });

  it("can backup database only", () => {
    const script = buildSiteBackupScript("exemplo.com.br", undefined, "database_only");
    expect(script).toContain("OPS_BACKUP_FILES_SKIP");
    expect(script).toContain("wp db export");
  });

  it("parses backup success markers", () => {
    const parsed = parseSiteBackupOutput(
      "OPS_BACKUP_FILES=/var/backups/opspanel/exemplo.com.br/1/files.tar.gz\nOPS_BACKUP_DB=/var/backups/opspanel/exemplo.com.br/1/database.sql.gz\nOPS_BACKUP_OK=1\nOPS_BACKUP_PATH=/var/backups/opspanel/exemplo.com.br/1",
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.databaseArchive).toContain("database.sql.gz");
  });

  it("parses markers with CR from PTY and ignores tar noise", () => {
    const parsed = parseSiteBackupOutput(
      "tar: ./htdocs/wp-content/wflogs/rules.php: file changed as we read it\r\nOPS_BACKUP_FILES=/var/backups/x/files.tar.gz\r\nOPS_BACKUP_OK=1\r\nOPS_BACKUP_PATH=/var/backups/x\r\n",
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.backupPath).toBe("/var/backups/x");
  });

  it("lists and parses backups on server", () => {
    const listed = parseSiteBackupListOutput(
      "OPS_BACKUP_ENTRY=20260814120000|/var/backups/opspanel/exemplo.com.br/20260814120000|1|12345\nOPS_BACKUP_ENTRY=20260813120000|/var/backups/opspanel/exemplo.com.br/20260813120000|0|999\nOPS_BACKUP_LIST_OK=1",
    );
    expect(listed).toHaveLength(2);
    expect(listed[0]?.hasDatabase).toBe(true);
    expect(listed[0]?.timestamp).toBe("20260814120000");
  });

  it("builds restore script with safety checks", () => {
    const script = buildSiteRestoreScript(
      "exemplo.com.br",
      "/var/backups/opspanel/exemplo.com.br/20260814120000",
    );
    expect(script).toContain("tar -xzf");
    expect(script).toContain("wp db import");
    expect(script).toContain("invalid_backup_path");
    expect(script).not.toContain("esac");
    expect(script).toContain("${BACKUP_DIR#");
  });

  it("parses restore success markers", () => {
    const parsed = parseSiteRestoreOutput(
      "OPS_RESTORE_FILES=1\nOPS_RESTORE_DB=1\nOPS_RESTORE_OK=1\nOPS_RESTORE_PATH=/var/backups/opspanel/x/20260814120000",
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.databaseRestored).toBe(true);
  });

  it("ignores restore script echoed on PTY and still reads success markers", () => {
    const script = buildSiteRestoreScript(
      "exemplo.com.br",
      "/var/backups/opspanel/exemplo.com.br/20260814120000",
    );
    const parsed = parseSiteRestoreOutput(
      `${script}\nOPS_RESTORE_FILES=1\nOPS_RESTORE_OK=1\nOPS_RESTORE_PATH=/var/backups/opspanel/exemplo.com.br/20260814120000\n`,
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.backupPath).toContain("20260814120000");
  });

  it("does not treat one-line script dump as restore error", () => {
    const dumped =
      'invalid_backup_path"; exit 1;; esac; test -d "$BACKUP_DIR" || { echo "OPS_RESTORE_ERROR=backup_not_found"; exit 1; }; echo "OPS_RESTORE_OK=1"';
    const parsed = parseSiteRestoreOutput(dumped);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).not.toContain("esac");
    expect(parsed.error).not.toContain("BACKUP_DIR");
  });

  it("maps real restore error lines to Portuguese", () => {
    const parsed = parseSiteRestoreOutput("OPS_RESTORE_ERROR=backup_not_found\n");
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("Backup não encontrado no servidor.");
  });
});

describe("buildSiteCreateScript", () => {
  it("builds wprocket create with letsencrypt and php83", () => {
    const script = buildSiteCreateScript({
      domain: "exemplo.com",
      siteType: "wprocket",
      sslMode: "letsencrypt",
      phpVersion: "83",
    });
    expect(script).toContain("wo site create");
    expect(script).toContain("--wprocket");
    expect(script).toContain("-le");
    expect(script).toContain("--php83");
  });

  it("exports cloudflare env for dns validation", () => {
    const script = buildSiteCreateScript({
      domain: "exemplo.com",
      siteType: "wp",
      sslMode: "letsencrypt_dns_cf",
      cloudflareApiKey: "test-key",
      cloudflareEmail: "admin@example.com",
    });
    expect(script).toContain("CF_Key=");
    expect(script).toContain("CF_Email=");
    expect(script).toContain("--dns=dns_cf");
  });
});

describe("parseSiteInfoOutput", () => {
  it("parses php version line", () => {
    const info = parseSiteInfoOutput("PHP Version : 8.2\nCache : redis");
    expect(info.phpVersion).toBe("8.2");
    expect(info.cacheBackend).toBe("redis");
  });

  it("parses wo site info table format", () => {
    const out = `Information about nutreum.com.br (domain):

Nginx configuration      wp basic (enabled)
PHP Version              8.2

SSL                      enabled
SSL PROVIDER             Lets Encrypt
SSL EXPIRY DATE          89

access_log               /var/www/nutreum.com.br/logs/access.log
error_log                /var/www/nutreum.com.br/logs/error.log
Webroot                  /var/www/nutreum.com.br

DB_NAME                  exampleFj8453l
DB_USER                  examplehhs5dlf96d
DB_PASS                  shevwse62342swe`;
    const info = parseSiteInfoOutput(out);
    expect(info.domain).toBe("nutreum.com.br");
    expect(info.siteType).toBe("wp");
    expect(info.isEnabled).toBe(true);
    expect(info.isWordPress).toBe(true);
    expect(info.phpVersion).toBe("8.2");
    expect(info.sslEnabled).toBe(true);
    expect(info.sslProvider).toBe("Lets Encrypt");
    expect(info.sslExpiryDays).toBe(89);
    expect(info.webroot).toBe("/var/www/nutreum.com.br");
    expect(info.dbName).toBe("exampleFj8453l");
    expect(info.dbUser).toBe("examplehhs5dlf96d");
    expect(info.dbPass).toBe("shevwse62342swe");
    expect(info.dbHost).toBe("localhost");
  });

  it("parses OPS_SITE_FEATURES markers from nginx probe", () => {
    const out = `Information about exemplo.com.br (domain):

Nginx configuration      wp wprocket (enabled)
PHP Version              8.3
SSL                      disabled

OPS_SITE_FEATURES_START
hsts=0
ngxblocker=0
ssl_le=0
www_alias=1
multisite=none
wordpress=1
nginx_stack=wprocket
redis_cache=0
fastcgi_cache=0
OPS_SITE_FEATURES_END`;
    const info = parseSiteInfoOutput(out);
    expect(info.siteType).toBe("wprocket");
    expect(info.isWordPress).toBe(true);
    expect(info.wwwAlias).toBe(true);
    expect(info.hstsEnabled).toBe(false);
    expect(info.ngxblockerEnabled).toBe(false);
    expect(info.multisite).toBe("none");
  });
});

describe("buildSiteWpAutologinScript", () => {
  it("checks site root and htdocs for wp-load.php", () => {
    const script = buildSiteWpAutologinScript("exemplo.com.br", "admin");
    expect(script).toContain('SITE_ROOT="/var/www/$DOMAIN"');
    expect(script).toContain("$SITE_ROOT/htdocs/wp-load.php");
    expect(script).toContain("$SITE_ROOT/wp-load.php");
    expect(script).toContain("wp login install --activate");
    expect(script).toContain("OPS_WP_LOGIN_URL=");
    expect(script).toContain("WP_USER='admin'");
  });

  it("uses webroot hint when provided", () => {
    const script = buildSiteWpAutologinScript("exemplo.com.br", undefined, "/var/www/exemplo.com.br");
    expect(script).toContain("HINT='/var/www/exemplo.com.br'");
  });
});

describe("parseSiteWpAutologinOutput", () => {
  it("parses login url marker", () => {
    const parsed = parseSiteWpAutologinOutput("OPS_WP_LOGIN_URL=https://exemplo.com/wp-login.php?token=abc");
    expect(parsed.url).toBe("https://exemplo.com/wp-login.php?token=abc");
  });

  it("parses error marker", () => {
    const parsed = parseSiteWpAutologinOutput("OPS_WP_LOGIN_ERROR=no_wp");
    expect(parsed.error).toBe("no_wp");
  });
});

describe("multisite migrate helpers", () => {
  it("parses subdirectory multisite from wp-config", () => {
    const cfg = [
      "define('DB_NAME', 'x');",
      "define('MULTISITE', true);",
      "define('SUBDOMAIN_INSTALL', false);",
      "define('DOMAIN_CURRENT_SITE', 'rede.exemplo.com.br');",
      "define('PATH_CURRENT_SITE', '/');",
    ].join("\n");
    expect(parseWpConfigMultisite(cfg)).toEqual({
      mode: "subdir",
      domainCurrentSite: "rede.exemplo.com.br",
      pathCurrentSite: "/",
    });
  });

  it("parses subdomain multisite from wp-config", () => {
    const cfg = [
      "define('MULTISITE', true);",
      "define('SUBDOMAIN_INSTALL', true);",
      "define('DOMAIN_CURRENT_SITE', 'exemplo.com');",
    ].join("\n");
    expect(parseWpConfigMultisite(cfg).mode).toBe("subdomain");
  });

  it("returns none when MULTISITE is absent", () => {
    expect(parseWpConfigMultisite("define('DB_NAME', 'x');").mode).toBe("none");
  });

  it("create script includes --wpsubdir for multisite subdir", () => {
    const script = buildSiteCreateScript({
      domain: "rede.exemplo.com",
      siteType: "wp",
      sslMode: "none",
      multisite: "subdir",
    });
    expect(script).toContain("--wpsubdir");
  });

  it("finalize script sets DOMAIN_CURRENT_SITE for subdir multisite", () => {
    const script = buildSiteMigrateFinalizeScript({
      domain: "novo.exemplo.com.br",
      destDb: { name: "db", user: "u", pass: "p", host: "localhost" },
      multisiteMode: "subdir",
      pathCurrentSite: "/",
    });
    expect(script).toContain("DOMAIN_CURRENT_SITE");
    expect(script).toContain("SUBDOMAIN_INSTALL false");
    expect(script).toContain("PATH_CURRENT_SITE");
    expect(script).toContain("OPS_MIGRATE_MULTISITE=subdir");
  });

  it("search-replace multisite replaces bare hostname", () => {
    const script = buildSiteMigrateSearchReplaceScript("novo.exemplo.com.br", "https://antigo.exemplo.com.br", {
      multisiteMode: "subdir",
    });
    expect(script).toContain("antigo.exemplo.com.br");
    expect(script).toContain("novo.exemplo.com.br");
    expect(script).toContain("OPS_MIGRATE_MULTISITE_URLS=1");
  });
});
