import type { SiteInfoSnapshot } from "./wordops-site-catalog.js";
import { WORDOPS_SITE_UPDATE_ACTIONS } from "./wordops-site-catalog.js";
export type SiteManageActionId = (typeof WORDOPS_SITE_UPDATE_ACTIONS)[number]["id"];

export const SITE_MANAGE_ACTION_LABELS: Record<string, string> = Object.fromEntries(
  WORDOPS_SITE_UPDATE_ACTIONS.map((a) => [a.id, a.label]),
);

export interface SiteManageResultState {
  sslEnabled?: boolean;
  siteType?: string;
  phpVersion?: string;
  isEnabled?: boolean;
  hstsEnabled?: boolean;
  ngxblockerEnabled?: boolean;
  cacheBackend?: string;
}

/** Mensagem amigável após uma ação WordOps no site, com verificação do estado real. */
export function buildSiteManageResultSummary(
  action: string,
  info?: SiteInfoSnapshot | SiteManageResultState | null,
): string {
  const ssl = info?.sslEnabled;
  const type = info?.siteType;
  const php = info?.phpVersion;
  const enabled = info?.isEnabled;

  switch (action) {
    case "letsencrypt":
    case "letsencrypt_dns_cf":
      return ssl
        ? "SSL ativado e detectado no servidor."
        : "Comando executado, mas o certificado ainda não aparece ativo. Confira DNS/proxy Cloudflare e tente novamente.";
    case "enable":
      return enabled !== false ? "Site ativo no Nginx." : "Site ainda aparece desativado. Aguarde a sincronização.";
    case "disable":
      return enabled === false ? "Site desativado no Nginx." : "Site ainda aparece ativo. Aguarde a sincronização.";
    case "update_wprocket":
      return type === "wprocket"
        ? "Stack WP Rocket confirmada no servidor."
        : `Comando concluído. Stack detectada: ${type ?? "desconhecida"}.`;
    case "update_wpfc":
      return type === "wpfc" ? "FastCGI cache confirmado no servidor." : `Stack detectada: ${type ?? "desconhecida"}.`;
    case "update_wpredis":
      return type === "wpredis" ? "Redis Object Cache confirmado." : `Stack detectada: ${type ?? "desconhecida"}.`;
    case "update_wpsc":
      return type === "wpsc" ? "WP Super Cache confirmado." : `Stack detectada: ${type ?? "desconhecida"}.`;
    case "update_wpce":
      return type === "wpce" ? "Cache Enabler confirmado." : `Stack detectada: ${type ?? "desconhecida"}.`;
    case "update_php81":
      return php?.startsWith("8.1") ? "PHP 8.1 confirmado no site." : `PHP detectado: ${php ?? "—"}.`;
    case "update_php82":
      return php?.startsWith("8.2") ? "PHP 8.2 confirmado no site." : `PHP detectado: ${php ?? "—"}.`;
    case "update_php83":
      return php?.startsWith("8.3") ? "PHP 8.3 confirmado no site." : `PHP detectado: ${php ?? "—"}.`;
    case "update_php84":
      return php?.startsWith("8.4") ? "PHP 8.4 confirmado no site." : `PHP detectado: ${php ?? "—"}.`;
    default:
      return "Operação concluída. Inventário atualizado abaixo.";
  }
}

export function siteManageStateFromInfo(info?: SiteInfoSnapshot | null): SiteManageResultState | undefined {
  if (!info) return undefined;
  return {
    sslEnabled: info.sslEnabled,
    siteType: info.siteType,
    phpVersion: info.phpVersion,
    isEnabled: info.isEnabled,
    hstsEnabled: info.hstsEnabled,
    ngxblockerEnabled: info.ngxblockerEnabled,
    cacheBackend: info.cacheBackend,
  };
}

/** Indica se a ação corresponde ao estado atual detectado no servidor. */
export function isSiteManageActionActive(actionId: string, info?: SiteInfoSnapshot | null): boolean {
  if (!info?.collectedAt) return false;

  const siteType = info.siteType?.toLowerCase();
  const php = info.phpVersion ?? "";
  const sslProvider = info.sslProvider?.toLowerCase() ?? "";

  switch (actionId) {
    case "enable":
      return info.isEnabled !== false;
    case "disable":
      return info.isEnabled === false;
    case "letsencrypt":
      if (!info.sslEnabled) return false;
      if (sslProvider.includes("cloudflare") || sslProvider.includes("dns")) return false;
      return true;
    case "letsencrypt_dns_cf":
      return Boolean(info.sslEnabled && (sslProvider.includes("cloudflare") || sslProvider.includes("dns")));
    case "update_wpfc":
      return siteType === "wpfc" || Boolean(info.fastcgiCache);
    case "update_wpredis":
      return siteType === "wpredis" || Boolean(info.redisObjectCache);
    case "update_wprocket":
      return siteType === "wprocket";
    case "update_wpsc":
      return siteType === "wpsc";
    case "update_wpce":
      return siteType === "wpce";
    case "update_php81":
      return php.startsWith("8.1");
    case "update_php82":
      return php.startsWith("8.2");
    case "update_php83":
      return php.startsWith("8.3");
    case "update_php84":
      return php.startsWith("8.4");
    default:
      return false;
  }
}