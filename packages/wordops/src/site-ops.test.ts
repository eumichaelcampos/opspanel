import { describe, expect, it } from "vitest";
import { buildSiteCreateScript, parseSiteInfoOutput } from "./site-ops.js";

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
    expect(script).toContain("--letsencrypt");
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
});