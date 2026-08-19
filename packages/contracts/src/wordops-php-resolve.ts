import { WORDOPS_PHP_VERSIONS, type WordOpsPhpVersionId } from "./wordops-site-catalog.js";

export type StackComponentRef = { id: string; installed: boolean; running?: boolean };

/** Ordem de preferência (mais recente primeiro). */
export const PHP_VERSION_PREFERENCE: WordOpsPhpVersionId[] = ["84", "83", "82", "81", "80", "74"];

export function phpVersionToStackId(version: WordOpsPhpVersionId): string | null {
  if (version === "default") return null;
  return `php${version}`;
}

export function stackIdToPhpVersion(stackId: string): WordOpsPhpVersionId | null {
  const match = stackId.match(/^php(\d{2})$/);
  if (!match?.[1]) return null;
  const id = match[1] as WordOpsPhpVersionId;
  return WORDOPS_PHP_VERSIONS.some((p) => p.id === id) ? id : null;
}

export function installedPhpVersionsFromStack(
  stackComponents?: StackComponentRef[] | null,
): WordOpsPhpVersionId[] {
  if (!stackComponents?.length) return [];
  const installed = new Set(
    stackComponents.filter((c) => c.installed && c.id.startsWith("php")).map((c) => c.id),
  );
  return PHP_VERSION_PREFERENCE.filter((v) => {
    const stackId = phpVersionToStackId(v);
    return stackId ? installed.has(stackId) : false;
  });
}

export function pickPreferredPhpVersion(
  requested: WordOpsPhpVersionId,
  stackComponents?: StackComponentRef[] | null,
): { phpVersion: WordOpsPhpVersionId; fallbackApplied: boolean; requested: WordOpsPhpVersionId } {
  const installed = installedPhpVersionsFromStack(stackComponents);

  if (requested === "default") {
    const best = installed[0] ?? "83";
    return { phpVersion: best, fallbackApplied: Boolean(installed.length), requested };
  }

  if (!stackComponents?.length) {
    return { phpVersion: requested, fallbackApplied: false, requested };
  }

  if (installed.includes(requested)) {
    return { phpVersion: requested, fallbackApplied: false, requested };
  }

  const requestedIdx = PHP_VERSION_PREFERENCE.indexOf(requested);
  const fallback =
    (requestedIdx >= 0 ? PHP_VERSION_PREFERENCE.slice(requestedIdx + 1).find((v) => installed.includes(v)) : undefined) ??
    installed[0] ??
    "83";

  return { phpVersion: fallback, fallbackApplied: true, requested };
}

export function buildPhpVersionOptionsForServer(stackComponents?: StackComponentRef[] | null) {
  const installed = new Set(installedPhpVersionsFromStack(stackComponents));
  const hasInventory = Boolean(stackComponents?.length);

  return WORDOPS_PHP_VERSIONS.map((p) => ({
    ...p,
    available: p.id === "default" ? true : !hasInventory || installed.has(p.id),
    installed: p.id !== "default" && installed.has(p.id),
  }));
}
