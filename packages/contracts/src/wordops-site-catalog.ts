/**
 * Catálogo WordOps mapeado da documentação oficial:
 * https://docs.wordops.net/commands/site/
 */

export const WORDOPS_SITE_TYPES = [
  { id: "html", label: "HTML estático", group: "basic", flag: "--html", desc: "Site estático sem PHP" },
  { id: "php", label: "PHP", group: "basic", flag: "--php", desc: "PHP sem banco de dados" },
  { id: "mysql", label: "PHP + MySQL", group: "basic", flag: "--mysql", desc: "PHP com MariaDB" },
  { id: "wp", label: "WordPress", group: "wordpress", flag: "--wp", desc: "WordPress sem cache" },
  { id: "wpfc", label: "WordPress + FastCGI", group: "wordpress", flag: "--wpfc", desc: "Cache Nginx fastcgi" },
  { id: "wpredis", label: "WordPress + Redis", group: "wordpress", flag: "--wpredis", desc: "Cache Redis Object" },
  { id: "wpsc", label: "WordPress + Super Cache", group: "wordpress", flag: "--wpsc", desc: "Plugin WP Super Cache" },
  { id: "wprocket", label: "WordPress + WP Rocket", group: "wordpress", flag: "--wprocket", desc: "Plugin WP Rocket" },
  { id: "wpce", label: "WordPress + Cache Enabler", group: "wordpress", flag: "--wpce", desc: "Plugin Cache Enabler" },
  { id: "proxy", label: "Proxy reverso", group: "advanced", flag: "--proxy", desc: "Proxy para app (Node, etc.)" },
  { id: "alias", label: "Alias / redirect", group: "advanced", flag: "--alias", desc: "Redireciona para outro domínio" },
] as const;

export const WORDOPS_PHP_VERSIONS = [
  { id: "default", label: "Padrão do servidor", flag: null },
  { id: "74", label: "PHP 7.4", flag: "--php74" },
  { id: "80", label: "PHP 8.0", flag: "--php80" },
  { id: "81", label: "PHP 8.1", flag: "--php81" },
  { id: "82", label: "PHP 8.2", flag: "--php82" },
  { id: "83", label: "PHP 8.3", flag: "--php83" },
  { id: "84", label: "PHP 8.4", flag: "--php84" },
] as const;

export const WORDOPS_MULTISITE = [
  { id: "none", label: "Site único", flags: [] as string[] },
  { id: "subdir", label: "Multisite (subpastas)", flags: ["--wpsubdir"] },
  { id: "subdomain", label: "Multisite (subdomínios)", flags: ["--wpsubdomain"] },
] as const;

/** Modos SSL conforme docs WordOps + Cloudflare DNS API */
export const WORDOPS_SSL_MODES = [
  {
    id: "none",
    label: "Sem SSL agora",
    desc: "Cria o site sem certificado. Você pode adicionar SSL depois.",
    flags: [] as string[],
    needsCloudflare: false,
  },
  {
    id: "letsencrypt",
    label: "Let's Encrypt (HTTP)",
    desc: "Validação webroot. Domínio deve apontar direto para o servidor (sem proxy Cloudflare laranja).",
    flags: ["--letsencrypt"],
    needsCloudflare: false,
  },
  {
    id: "letsencrypt_dns_cf",
    label: "Let's Encrypt + Cloudflare DNS",
    desc: "Validação via API DNS. Use quando Cloudflare estiver ativo (proxy laranja ou DNS only).",
    flags: ["--letsencrypt", "--dns=dns_cf"],
    needsCloudflare: true,
  },
  {
    id: "letsencrypt_wildcard_cf",
    label: "Wildcard + Cloudflare DNS",
    desc: "Certificado *.dominio e dominio via API Cloudflare.",
    flags: ["--letsencrypt=wildcard", "--dns=dns_cf"],
    needsCloudflare: true,
  },
] as const;

export const WORDOPS_EXTRA_FLAGS = [
  { id: "hsts", label: "HSTS", flag: "--hsts", desc: "HTTP Strict Transport Security (requer SSL)" },
  { id: "ngxblocker", label: "Nginx Bad Bot Blocker", flag: "--ngxblocker", desc: "Bloqueio de bots maliciosos" },
  { id: "vhostonly", label: "Somente vhost (WP)", flag: "--vhostonly", desc: "Cria vhost e banco sem instalar WordPress" },
] as const;

/** Ações de update disponíveis no detalhe do site */
export const WORDOPS_SITE_UPDATE_ACTIONS = [
  { id: "enable", label: "Ativar site", wo: "wo site enable" },
  { id: "disable", label: "Desativar site", wo: "wo site disable" },
  { id: "letsencrypt", label: "SSL Let's Encrypt (HTTP)", wo: "wo site update -le" },
  { id: "letsencrypt_dns_cf", label: "SSL via Cloudflare DNS", wo: "wo site update -le --dns=dns_cf", needsCloudflare: true },
  { id: "update_wpfc", label: "Migrar para WP + FastCGI cache", wo: "wo site update --wpfc" },
  { id: "update_wpredis", label: "Migrar para WP + Redis", wo: "wo site update --wpredis" },
  { id: "update_wprocket", label: "Migrar para WP + WP Rocket", wo: "wo site update --wprocket" },
  { id: "update_wpsc", label: "Migrar para WP + Super Cache", wo: "wo site update --wpsc" },
  { id: "update_wpce", label: "Migrar para WP + Cache Enabler", wo: "wo site update --wpce" },
  { id: "update_php81", label: "Alterar para PHP 8.1", wo: "wo site update --php81" },
  { id: "update_php82", label: "Alterar para PHP 8.2", wo: "wo site update --php82" },
  { id: "update_php83", label: "Alterar para PHP 8.3", wo: "wo site update --php83" },
  { id: "update_php84", label: "Alterar para PHP 8.4", wo: "wo site update --php84" },
] as const;

export type WordOpsSiteTypeId = (typeof WORDOPS_SITE_TYPES)[number]["id"];
export type WordOpsSslModeId = (typeof WORDOPS_SSL_MODES)[number]["id"];
export type WordOpsPhpVersionId = (typeof WORDOPS_PHP_VERSIONS)[number]["id"];
export type WordOpsMultisiteId = (typeof WORDOPS_MULTISITE)[number]["id"];

export interface SiteInfoSnapshot {
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
  multisite?: WordOpsMultisiteId | "multisite";
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
  /** Metadados de clone/staging (OpsPanel). */
  isStaging?: boolean;
  stagingOf?: string;
  clonedFrom?: string;
}

export interface SiteInventoryItem {
  id: string;
  label: string;
  category: "stack" | "cache" | "security" | "wordpress" | "network";
  active: boolean;
  detail?: string;
}

export interface SiteInventorySummary {
  active: SiteInventoryItem[];
  inactive: SiteInventoryItem[];
  needsRefresh: boolean;
}

function siteTypeLabel(siteType?: string): string {
  const def = WORDOPS_SITE_TYPES.find((t) => t.id === siteType);
  return def?.label ?? siteType ?? "Tipo desconhecido";
}

function cacheLabel(siteType?: string, info?: SiteInfoSnapshot): string | undefined {
  if (info?.fastcgiCache || siteType === "wpfc") return "FastCGI (Nginx)";
  if (info?.redisObjectCache || siteType === "wpredis") return "Redis Object Cache";
  if (siteType === "wprocket") return "WP Rocket";
  if (siteType === "wpsc") return "WP Super Cache";
  if (siteType === "wpce") return "Cache Enabler";
  if (info?.cacheBackend) return info.cacheBackend;
  return undefined;
}

function multisiteLabel(multisite?: SiteInfoSnapshot["multisite"]): string {
  if (multisite === "subdir") return "Multisite (subpastas)";
  if (multisite === "subdomain") return "Multisite (subdomínios)";
  if (multisite === "multisite") return "Multisite";
  return "Site único";
}

/** Inventário de recursos ativos/inativos no site (SSL, cache, HSTS, ngxblocker, etc.). */
export function resolveSiteInventory(info?: SiteInfoSnapshot | null): SiteInventorySummary {
  if (!info?.collectedAt) {
    return { active: [], inactive: [], needsRefresh: true };
  }

  const siteType = info.siteType;
  const isWp = Boolean(info.isWordPress || (siteType && /^wp/i.test(siteType)));
  const cacheActive = Boolean(
    siteType && ["wpfc", "wpredis", "wprocket", "wpsc", "wpce"].includes(siteType),
  );
  const cacheDetail = cacheLabel(siteType, info);
  const hasDb = Boolean(info.dbName || info.dbUser);

  const items: SiteInventoryItem[] = [
    {
      id: "site_type",
      label: siteTypeLabel(siteType),
      category: "stack",
      active: Boolean(siteType),
      detail: info.nginxConfig,
    },
    {
      id: "php",
      label: info.phpVersion ? `PHP ${info.phpVersion}` : "PHP",
      category: "stack",
      active: Boolean(info.phpVersion),
    },
    {
      id: "enabled",
      label: "Site ativo",
      category: "stack",
      active: info.isEnabled !== false,
      detail: info.isEnabled === false ? "Desativado no Nginx" : undefined,
    },
    {
      id: "ssl",
      label: "SSL / HTTPS",
      category: "security",
      active: Boolean(info.sslEnabled),
      detail: info.sslProvider
        ? `${info.sslProvider}${info.sslExpiryDays != null ? ` · expira em ${info.sslExpiryDays}d` : ""}`
        : info.sslLetsEncrypt
          ? "Let's Encrypt detectado"
          : undefined,
    },
    {
      id: "hsts",
      label: "HSTS",
      category: "security",
      active: Boolean(info.hstsEnabled),
    },
    {
      id: "ngxblocker",
      label: "Nginx Bad Bot Blocker",
      category: "security",
      active: Boolean(info.ngxblockerEnabled),
    },
    {
      id: "cache",
      label: cacheDetail ?? "Cache de página",
      category: "cache",
      active: cacheActive,
      detail: cacheActive ? siteTypeLabel(siteType) : undefined,
    },
    {
      id: "redis_cache",
      label: "Redis Object Cache",
      category: "cache",
      active: Boolean(info.redisObjectCache || siteType === "wpredis"),
    },
    {
      id: "fastcgi_cache",
      label: "FastCGI Cache (Nginx)",
      category: "cache",
      active: Boolean(info.fastcgiCache || siteType === "wpfc"),
    },
    {
      id: "wordpress",
      label: "WordPress",
      category: "wordpress",
      active: isWp,
    },
    {
      id: "multisite",
      label: multisiteLabel(info.multisite),
      category: "wordpress",
      active: Boolean(info.multisite && info.multisite !== "none"),
    },
    {
      id: "database",
      label: "MariaDB / MySQL",
      category: "wordpress",
      active: hasDb,
      detail: info.dbName,
    },
    {
      id: "www_alias",
      label: "Alias www",
      category: "network",
      active: Boolean(info.wwwAlias),
      detail: info.wwwAlias ? "www incluído no server_name" : undefined,
    },
  ];

  const deduped = items.filter((item, idx, arr) => arr.findIndex((x) => x.id === item.id) === idx);

  return {
    active: deduped.filter((i) => i.active),
    inactive: deduped.filter((i) => !i.active),
    needsRefresh: false,
  };
}
