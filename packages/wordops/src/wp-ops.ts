/** WP-CLI probes for WordPress Center (inventory + updates). */

const DOMAIN_REGEX = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

const WO_PATH =
  "export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH";

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function validateDomain(domain: string): boolean {
  return DOMAIN_REGEX.test(domain.toLowerCase());
}

export type ParsedWpPlugin = {
  name: string;
  status?: string;
  version?: string;
  update?: string | null;
  updateVersion?: string | null;
  title?: string;
};

export type ParsedWpTheme = {
  name: string;
  status?: string;
  version?: string;
  update?: string | null;
  updateVersion?: string | null;
  title?: string;
};

export type ParsedWpInventory = {
  collectedAt: string;
  domain?: string;
  coreVersion?: string;
  coreUpdateAvailable?: boolean;
  coreUpdateVersion?: string | null;
  isMultisite?: boolean;
  plugins: ParsedWpPlugin[];
  themes: ParsedWpTheme[];
  pluginUpdates: number;
  themeUpdates: number;
  error?: string;
};

export type WpUpdateTarget = "core" | "plugins" | "themes" | string;

function wpRootResolveLines(): string[] {
  return [
    `SITE_ROOT="/var/www/$DOMAIN"`,
    `WP_ROOT=""`,
    `if [ -f "$SITE_ROOT/htdocs/wp-load.php" ]; then WP_ROOT="$SITE_ROOT/htdocs"; fi`,
    `if [ -z "$WP_ROOT" ] && [ -f "$SITE_ROOT/wp-load.php" ]; then WP_ROOT="$SITE_ROOT"; fi`,
  ];
}

/** Inventário WP-CLI: core, plugins, temas e multisite. */
export function buildWpInventoryScript(domain: string): string {
  const d = domain.toLowerCase();
  if (!validateDomain(d)) throw new Error("Domínio inválido");

  return [
    WO_PATH,
    `DOMAIN=${shellQuote(d)}`,
    ...wpRootResolveLines(),
    'echo "===OPS_WP_INV==="',
    'echo "COLLECTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)"',
    'echo "DOMAIN=$DOMAIN"',
    'if [ -z "$WP_ROOT" ] || [ ! -f "$WP_ROOT/wp-load.php" ]; then',
    '  echo "ERROR=not_wordpress"',
    '  echo "===OPS_WP_INV_END==="',
    "  exit 0",
    "fi",
    'if ! command -v wp >/dev/null 2>&1; then',
    '  echo "ERROR=wp_cli_missing"',
    '  echo "===OPS_WP_INV_END==="',
    "  exit 0",
    "fi",
    'CORE_VER=$(wp core version --path="$WP_ROOT" --allow-root 2>/dev/null || true)',
    'echo "CORE_VERSION=$CORE_VER"',
    'CORE_CHECK=$(wp core check-update --format=json --path="$WP_ROOT" --allow-root 2>/dev/null || echo "[]")',
    'echo "CORE_CHECK_JSON=$CORE_CHECK"',
    'if wp core is-installed --network --path="$WP_ROOT" --allow-root >/dev/null 2>&1; then echo "IS_MULTISITE=1"; else echo "IS_MULTISITE=0"; fi',
    'echo "PLUGINS_JSON_BEGIN"',
    'wp plugin list --format=json --fields=name,status,version,update,update_version,title --path="$WP_ROOT" --allow-root 2>/dev/null || echo "[]"',
    'echo "PLUGINS_JSON_END"',
    'echo "THEMES_JSON_BEGIN"',
    'wp theme list --format=json --fields=name,status,version,update,update_version,title --path="$WP_ROOT" --allow-root 2>/dev/null || echo "[]"',
    'echo "THEMES_JSON_END"',
    'echo "===OPS_WP_INV_END==="',
  ].join("\n");
}

export function wpInventoryProbe(domain: string): readonly string[] {
  return ["bash", "-lc", buildWpInventoryScript(domain)];
}

function extractMarkerBlock(output: string, begin: string, end: string): string {
  const start = output.indexOf(begin);
  const stop = output.indexOf(end);
  if (start < 0) return "";
  return output.slice(start + begin.length, stop >= 0 ? stop : undefined).trim();
}

function extractJsonArray(block: string, beginMarker: string, endMarker: string): unknown[] {
  const raw = extractMarkerBlock(block, beginMarker, endMarker);
  if (!raw) return [];
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    const match = trimmed.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try {
      const parsed = JSON.parse(match[0]);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}

function mapPlugin(row: Record<string, unknown>): ParsedWpPlugin {
  const update = row.update != null ? String(row.update) : null;
  const updateVersion =
    row.update_version != null
      ? String(row.update_version)
      : row.updateVersion != null
        ? String(row.updateVersion)
        : null;
  return {
    name: String(row.name ?? ""),
    status: row.status != null ? String(row.status) : undefined,
    version: row.version != null ? String(row.version) : undefined,
    update: update === "" ? null : update,
    updateVersion: updateVersion === "" || updateVersion === "null" ? null : updateVersion,
    title: row.title != null ? String(row.title) : undefined,
  };
}

function mapTheme(row: Record<string, unknown>): ParsedWpTheme {
  return mapPlugin(row) as ParsedWpTheme;
}

function hasUpdate(update?: string | null): boolean {
  if (!update) return false;
  const v = update.toLowerCase();
  return v !== "none" && v !== "false" && v !== "0";
}

export function parseWpInventoryOutput(output: string): ParsedWpInventory {
  const text = stripAnsi(output);
  const start = text.indexOf("===OPS_WP_INV===");
  const end = text.indexOf("===OPS_WP_INV_END===");
  const block = start >= 0 ? text.slice(start, end >= 0 ? end : undefined) : text;

  const get = (key: string) => {
    const m = block.match(new RegExp(`^${key}=(.*)$`, "m"));
    return m?.[1]?.trim();
  };

  const collectedAt = get("COLLECTED_AT") || new Date().toISOString();
  const error = get("ERROR");
  if (error) {
    return {
      collectedAt,
      domain: get("DOMAIN"),
      plugins: [],
      themes: [],
      pluginUpdates: 0,
      themeUpdates: 0,
      error,
    };
  }

  const coreCheckRaw = get("CORE_CHECK_JSON") || "[]";
  let coreUpdateAvailable = false;
  let coreUpdateVersion: string | null = null;
  try {
    const check = JSON.parse(coreCheckRaw);
    if (Array.isArray(check) && check.length > 0) {
      coreUpdateAvailable = true;
      const first = check[0] as Record<string, unknown>;
      coreUpdateVersion =
        first.version != null
          ? String(first.version)
          : first.update_version != null
            ? String(first.update_version)
            : null;
    } else if (check && typeof check === "object" && !Array.isArray(check)) {
      const obj = check as Record<string, unknown>;
      if (obj.version || obj.update_version) {
        coreUpdateAvailable = true;
        coreUpdateVersion = String(obj.version ?? obj.update_version);
      }
    }
  } catch {
    // check-update pode imprimir mensagem de texto quando não há update
    if (/Success:\s*WordPress is at the latest/i.test(coreCheckRaw)) {
      coreUpdateAvailable = false;
    } else if (/version\s+\d/i.test(coreCheckRaw) && !/\[\]/.test(coreCheckRaw)) {
      coreUpdateAvailable = true;
    }
  }

  const pluginRows = extractJsonArray(block, "PLUGINS_JSON_BEGIN", "PLUGINS_JSON_END") as Record<
    string,
    unknown
  >[];
  const themeRows = extractJsonArray(block, "THEMES_JSON_BEGIN", "THEMES_JSON_END") as Record<
    string,
    unknown
  >[];

  const plugins = pluginRows.filter((r) => r && r.name).map(mapPlugin);
  const themes = themeRows.filter((r) => r && r.name).map(mapTheme);
  const pluginUpdates = plugins.filter((p) => hasUpdate(p.update)).length;
  const themeUpdates = themes.filter((t) => hasUpdate(t.update)).length;

  return {
    collectedAt,
    domain: get("DOMAIN"),
    coreVersion: get("CORE_VERSION") || undefined,
    coreUpdateAvailable,
    coreUpdateVersion,
    isMultisite: get("IS_MULTISITE") === "1",
    plugins,
    themes,
    pluginUpdates,
    themeUpdates,
  };
}

/** Atualiza core / plugins / themes conforme targets. */
export function buildWpUpdateScript(domain: string, targets: WpUpdateTarget[]): string {
  const d = domain.toLowerCase();
  if (!validateDomain(d)) throw new Error("Domínio inválido");
  if (!targets.length) throw new Error("Nenhum alvo de atualização");

  const wantCore = targets.includes("core");
  const wantAllPlugins = targets.includes("plugins");
  const wantAllThemes = targets.includes("themes");
  const specific = [
    ...new Set(
      targets.filter(
        (t) => t !== "core" && t !== "plugins" && t !== "themes" && /^[a-z0-9_-]+$/i.test(t),
      ),
    ),
  ];

  const lines: string[] = [
    WO_PATH,
    `DOMAIN=${shellQuote(d)}`,
    ...wpRootResolveLines(),
    'echo "===OPS_WP_UPDATE==="',
    'if [ -z "$WP_ROOT" ] || [ ! -f "$WP_ROOT/wp-load.php" ]; then echo "ERROR=not_wordpress"; echo "===OPS_WP_UPDATE_END==="; exit 1; fi',
    'if ! command -v wp >/dev/null 2>&1; then echo "ERROR=wp_cli_missing"; echo "===OPS_WP_UPDATE_END==="; exit 1; fi',
  ];

  if (wantCore) {
    lines.push('echo "STEP=core"');
    lines.push('wp core update --path="$WP_ROOT" --allow-root');
    lines.push('wp core update-db --path="$WP_ROOT" --allow-root 2>/dev/null || true');
  }

  if (wantAllPlugins) {
    lines.push('echo "STEP=plugins_all"');
    lines.push('wp plugin update --all --path="$WP_ROOT" --allow-root');
  } else if (specific.length) {
    const quoted = specific.map((s) => shellQuote(s)).join(" ");
    lines.push('echo "STEP=plugins_specific"');
    lines.push(`wp plugin update ${quoted} --path="$WP_ROOT" --allow-root 2>/dev/null || true`);
  }

  if (wantAllThemes) {
    lines.push('echo "STEP=themes_all"');
    lines.push('wp theme update --all --path="$WP_ROOT" --allow-root');
  } else if (specific.length) {
    const quoted = specific.map((s) => shellQuote(s)).join(" ");
    lines.push('echo "STEP=themes_specific"');
    lines.push(`wp theme update ${quoted} --path="$WP_ROOT" --allow-root 2>/dev/null || true`);
  }

  if (!wantCore && !wantAllPlugins && !wantAllThemes && !specific.length) {
    throw new Error("Nenhum alvo de atualização válido");
  }

  lines.push('echo "OPS_WP_UPDATE_DONE=1"');
  lines.push('echo "===OPS_WP_UPDATE_END==="');
  return lines.join("\n");
}

export function wpUpdateProbe(domain: string, targets: WpUpdateTarget[]): readonly string[] {
  return ["bash", "-lc", buildWpUpdateScript(domain, targets)];
}

export function parseWpUpdateOutput(output: string): {
  ok: boolean;
  done: boolean;
  error?: string;
} {
  const text = stripAnsi(output);
  const errMatch = text.match(/^ERROR=(\S+)/m);
  if (errMatch?.[1]) return { ok: false, done: false, error: errMatch[1] };
  const done = /OPS_WP_UPDATE_DONE=1/.test(text);
  if (done) return { ok: true, done: true };
  if (/Error:/i.test(text) && !/Success:/i.test(text)) {
    return { ok: false, done: false, error: text.slice(-400) };
  }
  return { ok: done, done };
}
