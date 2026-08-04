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
