/** Allowlisted remote probes (argv arrays, never shell strings). */
export const WO_VERSION_SHELL =
  "(command -v wo >/dev/null && wo --version 2>/dev/null | head -1) || (/usr/local/bin/wo --version 2>/dev/null | head -1 || true)";

export const RemoteProbes = {
  osRelease: ["cat", "/etc/os-release"],
  wordopsVersion: [
    "bash",
    "-lc",
    `export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH; ${WO_VERSION_SHELL}`,
  ],
  siteList: [
    "bash",
    "-lc",
    "export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH; (command -v wo >/dev/null && wo site list) || (/usr/local/bin/wo site list)",
  ],
  uname: ["uname", "-a"],
} as const;

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

/** Converte probe argv em comando remoto com quoting seguro. */
export function formatRemoteCommand(probe: readonly string[]): string {
  if (probe.length >= 3 && probe[0] === "bash" && probe[1] === "-lc") {
    const script = probe.slice(2).join(" ");
    return `bash -lc ${shellQuote(script)}`;
  }
  return probe.map((part) => shellQuote(part)).join(" ");
}

const DOMAIN_REGEX =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/** Remove sequências ANSI (ex.: cores do wo site list). */
export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

export interface ParsedSiteListEntry {
  domain: string;
  rawLine: string;
}

/** Extrai domínios válidos das linhas de `wo site list` (formato pode variar por versão). */
export function parseSiteListOutput(output: string): ParsedSiteListEntry[] {
  const seen = new Set<string>();
  const entries: ParsedSiteListEntry[] = [];

  for (const rawLine of output.split("\n")) {
    const line = stripAnsi(rawLine).trim();
    if (!line || line.startsWith("#") || /^[+\-|]+$/.test(line)) continue;
    if (/^(site\s+domain|id\s+domain)/i.test(line)) continue;

    const pipeCells = line.includes("|") ? line.split("|").map((c) => c.trim()).filter(Boolean) : [];
    const tokens = pipeCells.length > 0 ? pipeCells : line.split(/\s+/).filter(Boolean);
    for (const token of tokens) {
      const domain = token.replace(/^\*+/, "").toLowerCase();
      if (!DOMAIN_REGEX.test(domain)) continue;
      if (seen.has(domain)) continue;
      seen.add(domain);
      entries.push({ domain, rawLine: line });
    }
  }

  return entries;
}

const WORDOPS_VERSION_REGEX = /WordOps\s+v?([\d.]+)/i;

export function parseWordOpsVersion(output: string): string | undefined {
  const cleaned = stripAnsi(output);
  const wordopsMatch = cleaned.match(/WordOps\s+v?([\d.]+)/i);
  if (wordopsMatch?.[1]) return wordopsMatch[1];
  const semver = cleaned.match(/\b(\d+\.\d+\.\d+)\b/);
  return semver?.[1];
}

export function parseOsPrettyName(osRelease: string): string | undefined {
  const line = osRelease.split("\n").find((l) => l.startsWith("PRETTY_NAME="));
  if (!line) return undefined;
  return line.replace(/^PRETTY_NAME="/, "").replace(/"$/, "");
}

export * from "./site-ops.js";
export * from "./server-ops.js";
export * from "./security-ops.js";
export * from "./wp-ops.js";
export * from "./netdata-client.js";
