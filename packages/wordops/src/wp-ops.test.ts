import { describe, expect, it } from "vitest";
import {
  buildWpInventoryScript,
  buildWpUpdateScript,
  parseWpInventoryOutput,
  parseWpUpdateOutput,
} from "./wp-ops.js";

describe("wp-ops", () => {
  it("builds inventory script for valid domain", () => {
    const script = buildWpInventoryScript("example.com");
    expect(script).toContain('SITE_ROOT="/var/www/$DOMAIN"');
    expect(script).toContain("$SITE_ROOT/htdocs");
    expect(script).toContain("wp core version");
    expect(script).toContain("--allow-root");
    expect(script).toContain("===OPS_WP_INV===");
  });

  it("rejects invalid domain", () => {
    expect(() => buildWpInventoryScript("not a domain")).toThrow(/inválido/i);
  });

  it("parses inventory markers", () => {
    const output = `
===OPS_WP_INV===
COLLECTED_AT=2026-08-21T12:00:00Z
DOMAIN=example.com
CORE_VERSION=6.6.1
CORE_CHECK_JSON=[{"version":"6.6.2"}]
IS_MULTISITE=0
PLUGINS_JSON_BEGIN
[{"name":"akismet","status":"active","version":"5.0","update":"available","update_version":"5.1","title":"Akismet"}]
PLUGINS_JSON_END
THEMES_JSON_BEGIN
[{"name":"twentytwentyfour","status":"active","version":"1.0","update":"none","update_version":"","title":"Twenty Twenty-Four"}]
THEMES_JSON_END
===OPS_WP_INV_END===
`;
    const parsed = parseWpInventoryOutput(output);
    expect(parsed.coreVersion).toBe("6.6.1");
    expect(parsed.coreUpdateAvailable).toBe(true);
    expect(parsed.coreUpdateVersion).toBe("6.6.2");
    expect(parsed.plugins).toHaveLength(1);
    expect(parsed.pluginUpdates).toBe(1);
    expect(parsed.themeUpdates).toBe(0);
    expect(parsed.isMultisite).toBe(false);
  });

  it("builds update script for core+plugins", () => {
    const script = buildWpUpdateScript("blog.example.com", ["core", "plugins"]);
    expect(script).toContain("wp core update");
    expect(script).toContain("wp plugin update --all");
    expect(script).not.toContain("wp theme update --all");
  });

  it("parses update done marker", () => {
    expect(parseWpUpdateOutput("OPS_WP_UPDATE_DONE=1")).toEqual({ ok: true, done: true });
  });
});
