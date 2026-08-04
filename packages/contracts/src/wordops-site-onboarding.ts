/**
 * Wizard de criação de site com linguagem acessível para usuários leigos.
 * Mapeia opções WordOps para textos claros e guia passo a passo.
 */

import {
  WORDOPS_EXTRA_FLAGS,
  WORDOPS_MULTISITE,
  WORDOPS_PHP_VERSIONS,
  WORDOPS_SITE_TYPES,
  WORDOPS_SSL_MODES,
  type WordOpsMultisiteId,
  type WordOpsPhpVersionId,
  type WordOpsSiteTypeId,
  type WordOpsSslModeId,
} from "./wordops-site-catalog.js";

export type SiteCreationStepId =
  | "where"
  | "kind"
  | "wordpress"
  | "destination"
  | "security"
  | "extras"
  | "review";

export interface SiteCreationStepDef {
  id: SiteCreationStepId;
  label: string;
  description: string;
  helpText?: string;
  optional?: boolean;
}

export interface SiteCreationDraft {
  serverId: string;
  domain: string;
  siteType: WordOpsSiteTypeId;
  multisite: WordOpsMultisiteId;
  phpVersion: WordOpsPhpVersionId;
  sslMode: WordOpsSslModeId;
  hsts: boolean;
  ngxblocker: boolean;
  vhostOnly: boolean;
  proxyTarget: string;
  aliasTarget: string;
  cfKey: string;
  cfEmail: string;
  wpUser: string;
  wpPass: string;
  wpEmail: string;
}

export const WP_SITE_TYPES = new Set<WordOpsSiteTypeId>([
  "wp",
  "wpfc",
  "wpredis",
  "wpsc",
  "wprocket",
  "wpce",
]);

export const DEFAULT_SITE_CREATION_DRAFT: SiteCreationDraft = {
  serverId: "",
  domain: "",
  siteType: "wprocket",
  multisite: "none",
  phpVersion: "83",
  sslMode: "letsencrypt_dns_cf",
  hsts: false,
  ngxblocker: false,
  vhostOnly: false,
  proxyTarget: "127.0.0.1:3000",
  aliasTarget: "",
  cfKey: "",
  cfEmail: "",
  wpUser: "admin",
  wpPass: "",
  wpEmail: "",
};

export const SITE_CREATION_STEPS: SiteCreationStepDef[] = [
  {
    id: "where",
    label: "Onde vai ficar o site?",
    description: "Escolha o servidor e informe o endereço do site na internet.",
    helpText: "Use o domínio que você comprou, por exemplo: minhaloja.com.br",
  },
  {
    id: "kind",
    label: "O que você quer criar?",
    description: "Escolha o tipo de site. Para a maioria dos casos, WordPress com WP Rocket é a melhor opção.",
    helpText: "Para a maioria dos casos, WordPress com WP Rocket é a melhor opção. Lembre-se: o WP Rocket é um plugin pago.",
  },
  {
    id: "wordpress",
    label: "Conta do WordPress",
    description: "Defina o usuário administrador do painel WordPress. Senha e e-mail são opcionais.",
    helpText: "Se deixar em branco, o WordOps gera automaticamente.",
  },
  {
    id: "destination",
    label: "Destino do site",
    description: "Informe para onde o tráfego deve ser enviado.",
  },
  {
    id: "security",
    label: "Cadeado de segurança (SSL)",
    description: "Escolha como ativar o HTTPS (cadeado verde) no navegador.",
    helpText: "Se usa Cloudflare, escolha a opção com Cloudflare. Caso contrário, use validação direta.",
  },
  {
    id: "extras",
    label: "Ajustes finos",
    description: "Versão do PHP e opções extras. Pode manter os padrões recomendados.",
    optional: true,
  },
  {
    id: "review",
    label: "Revisar e publicar",
    description: "Confira o resumo antes de criar o site no servidor.",
  },
];

export const WPROCKET_WHATSAPP_PHONE = "5521979107506";
export const WPROCKET_WHATSAPP_MESSAGE = "Olá, vim pelo OpsPanel e quero comprar o WP Rocket";

export function getWpRocketPurchaseWhatsAppUrl(): string {
  return `https://wa.me/${WPROCKET_WHATSAPP_PHONE}?text=${encodeURIComponent(WPROCKET_WHATSAPP_MESSAGE)}`;
}

export const WPROCKET_LICENSE_NOTICE =
  "O WP Rocket é um plugin pago. O WordOps prepara o site, mas a licença do plugin precisa ser adquirida à parte.";

/** Rótulos amigáveis para tipos de site (sem jargão técnico). */
export const SITE_TYPE_FRIENDLY: Record<
  WordOpsSiteTypeId,
  {
    label: string;
    desc: string;
    notice?: string;
    recommended?: boolean;
    group: "recommended" | "wordpress" | "simple" | "advanced";
  }
> = {
  wprocket: {
    label: "WordPress com WP Rocket (recomendado)",
    desc: "WordPress com o plugin WP Rocket para deixar o site mais rápido. Ideal para blogs, lojas e sites institucionais.",
    notice: WPROCKET_LICENSE_NOTICE,
    recommended: true,
    group: "recommended",
  },
  wp: {
    label: "WordPress simples",
    desc: "WordPress sem plugin de cache extra.",
    group: "wordpress",
  },
  wpfc: {
    label: "WordPress + cache Nginx",
    desc: "WordPress com cache no servidor web.",
    group: "wordpress",
  },
  wpredis: {
    label: "WordPress + Redis",
    desc: "WordPress com cache em memória (Redis).",
    group: "wordpress",
  },
  wpsc: {
    label: "WordPress + Super Cache",
    desc: "WordPress com plugin WP Super Cache.",
    group: "wordpress",
  },
  wpce: {
    label: "WordPress + Cache Enabler",
    desc: "WordPress com plugin Cache Enabler.",
    group: "wordpress",
  },
  html: {
    label: "Página estática",
    desc: "Arquivos HTML simples, sem WordPress.",
    group: "simple",
  },
  php: {
    label: "Site em PHP",
    desc: "Aplicação PHP sem banco de dados.",
    group: "simple",
  },
  mysql: {
    label: "PHP com banco de dados",
    desc: "Site PHP que usa MariaDB/MySQL.",
    group: "simple",
  },
  proxy: {
    label: "Encaminhar para outro programa",
    desc: "O domínio aponta para uma aplicação (Node, Python, etc.) na porta local.",
    group: "advanced",
  },
  alias: {
    label: "Redirecionar domínio",
    desc: "Um domínio redireciona visitantes para outro endereço.",
    group: "advanced",
  },
};

export const SSL_MODE_FRIENDLY: Record<
  WordOpsSslModeId,
  { label: string; desc: string; recommended?: boolean }
> = {
  letsencrypt_dns_cf: {
    label: "Cadeado com Cloudflare (recomendado)",
    desc: "Use se o domínio passa pela Cloudflare (nuvem laranja ou DNS only).",
    recommended: true,
  },
  letsencrypt: {
    label: "Cadeado direto no servidor",
    desc: "Use se o domínio aponta direto para o IP do servidor, sem Cloudflare.",
  },
  letsencrypt_wildcard_cf: {
    label: "Cadeado wildcard + Cloudflare",
    desc: "Certificado para *.seudominio.com e seudominio.com via API Cloudflare.",
  },
  none: {
    label: "Publicar agora, cadeado depois",
    desc: "O site fica em HTTP. Você pode adicionar SSL mais tarde.",
  },
};

const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export function isWordPressSiteType(siteType: WordOpsSiteTypeId): boolean {
  return WP_SITE_TYPES.has(siteType);
}

export function sslModeNeedsCloudflare(sslMode: WordOpsSslModeId): boolean {
  return sslMode === "letsencrypt_dns_cf" || sslMode === "letsencrypt_wildcard_cf";
}

export function getVisibleSiteCreationSteps(draft: SiteCreationDraft): SiteCreationStepDef[] {
  return SITE_CREATION_STEPS.filter((step) => {
    if (step.id === "wordpress") return isWordPressSiteType(draft.siteType);
    if (step.id === "destination") return draft.siteType === "proxy" || draft.siteType === "alias";
    return true;
  });
}

export function siteCreationProgress(currentStepId: SiteCreationStepId, draft: SiteCreationDraft): number {
  const visible = getVisibleSiteCreationSteps(draft);
  const idx = visible.findIndex((s) => s.id === currentStepId);
  if (idx < 0) return 0;
  return Math.round(((idx + 1) / visible.length) * 100);
}

export function validateSiteCreationStep(
  stepId: SiteCreationStepId,
  draft: SiteCreationDraft,
): { ok: boolean; message?: string } {
  switch (stepId) {
    case "where": {
      if (!draft.serverId) return { ok: false, message: "Selecione em qual servidor o site será criado." };
      const domain = draft.domain.toLowerCase().trim();
      if (!domain) return { ok: false, message: "Informe o endereço do site (domínio)." };
      if (!DOMAIN_RE.test(domain)) {
        return { ok: false, message: "Domínio inválido. Exemplo: minhaloja.com.br" };
      }
      return { ok: true };
    }
    case "kind":
      if (!draft.siteType) return { ok: false, message: "Escolha o tipo de site." };
      return { ok: true };
    case "wordpress":
      if (draft.wpUser.trim().length < 1) {
        return { ok: false, message: "Informe um nome de usuário para o WordPress (ex: admin)." };
      }
      return { ok: true };
    case "destination":
      if (draft.siteType === "proxy" && !draft.proxyTarget.trim()) {
        return { ok: false, message: "Informe para onde encaminhar (ex: 127.0.0.1:3000)." };
      }
      if (draft.siteType === "alias" && !draft.aliasTarget.trim()) {
        return { ok: false, message: "Informe o domínio de destino do redirecionamento." };
      }
      return { ok: true };
    case "security":
      if (sslModeNeedsCloudflare(draft.sslMode)) {
        if (!draft.cfKey.trim()) return { ok: false, message: "Informe a chave de API da Cloudflare." };
        if (!draft.cfEmail.trim()) return { ok: false, message: "Informe o e-mail da conta Cloudflare." };
      }
      return { ok: true };
    case "extras":
    case "review":
      return { ok: true };
    default:
      return { ok: true };
  }
}

export function validateSiteCreationDraft(draft: SiteCreationDraft): { ok: boolean; message?: string } {
  for (const step of getVisibleSiteCreationSteps(draft)) {
    if (step.id === "review") continue;
    const result = validateSiteCreationStep(step.id, draft);
    if (!result.ok) return result;
  }
  return { ok: true };
}

export function buildSiteCreatePayload(draft: SiteCreationDraft) {
  const isWp = isWordPressSiteType(draft.siteType);
  const needsCf = sslModeNeedsCloudflare(draft.sslMode);
  return {
    serverId: draft.serverId,
    domain: draft.domain.toLowerCase().trim(),
    siteType: draft.siteType,
    multisite: isWp ? draft.multisite : "none" as const,
    phpVersion: draft.phpVersion,
    sslMode: draft.sslMode,
    hsts: draft.hsts || undefined,
    ngxblocker: draft.ngxblocker || undefined,
    vhostOnly: isWp && draft.vhostOnly ? true : undefined,
    proxyTarget: draft.siteType === "proxy" ? draft.proxyTarget : undefined,
    aliasTarget: draft.siteType === "alias" ? draft.aliasTarget : undefined,
    cloudflareApiKey: needsCf ? draft.cfKey : undefined,
    cloudflareEmail: needsCf ? draft.cfEmail : undefined,
    wpUser: isWp ? draft.wpUser : undefined,
    wpPass: isWp && draft.wpPass ? draft.wpPass : undefined,
    wpEmail: isWp && draft.wpEmail ? draft.wpEmail : undefined,
  };
}

export function buildSiteCreationSummary(
  draft: SiteCreationDraft,
  serverName?: string,
): { label: string; value: string }[] {
  const typeFriendly = SITE_TYPE_FRIENDLY[draft.siteType];
  const sslFriendly = SSL_MODE_FRIENDLY[draft.sslMode];
  const phpLabel = WORDOPS_PHP_VERSIONS.find((p) => p.id === draft.phpVersion)?.label ?? draft.phpVersion;

  const lines: { label: string; value: string }[] = [
    { label: "Servidor", value: serverName ?? draft.serverId },
    { label: "Endereço do site", value: draft.domain.toLowerCase().trim() },
    { label: "Tipo", value: typeFriendly?.label ?? draft.siteType },
    { label: "Cadeado (SSL)", value: sslFriendly?.label ?? draft.sslMode },
    { label: "Versão PHP", value: phpLabel },
  ];

  if (isWordPressSiteType(draft.siteType)) {
    lines.push({ label: "Usuário WordPress", value: draft.wpUser });
    if (draft.multisite !== "none") {
      const ms = WORDOPS_MULTISITE.find((m) => m.id === draft.multisite);
      lines.push({ label: "Multisite", value: ms?.label ?? draft.multisite });
    }
  }

  if (draft.siteType === "proxy") {
    lines.push({ label: "Encaminhar para", value: draft.proxyTarget });
  }
  if (draft.siteType === "alias") {
    lines.push({ label: "Redirecionar para", value: draft.aliasTarget });
  }

  const extras: string[] = [];
  if (draft.hsts) extras.push("HSTS");
  if (draft.ngxblocker) extras.push("Bloqueio de bots");
  if (draft.vhostOnly) extras.push("Somente estrutura (sem instalar WP)");
  if (extras.length) lines.push({ label: "Extras", value: extras.join(", ") });

  return lines;
}

/** Preview simplificado do comando (para usuários avançados). */
export function buildSiteCreateCommandPreview(draft: SiteCreationDraft): string {
  const typeDef = WORDOPS_SITE_TYPES.find((t) => t.id === draft.siteType);
  const flags: string[] = [typeDef?.flag ?? `--${draft.siteType}`];

  const php = WORDOPS_PHP_VERSIONS.find((p) => p.id === draft.phpVersion);
  if (php?.flag) flags.push(php.flag);

  const ssl = WORDOPS_SSL_MODES.find((s) => s.id === draft.sslMode);
  if (ssl?.flags.length) flags.push(...ssl.flags);

  if (draft.hsts) flags.push("--hsts");
  if (draft.ngxblocker) flags.push("--ngxblocker");
  if (draft.vhostOnly && isWordPressSiteType(draft.siteType)) flags.push("--vhostonly");

  return `wo site create ${draft.domain.toLowerCase().trim()} ${flags.join(" ")}`;
}

export function getSiteTypeOptionsForWizard() {
  const order: WordOpsSiteTypeId[] = [
    "wprocket",
    "wp",
    "wpfc",
    "wpredis",
    "html",
    "php",
    "mysql",
    "proxy",
    "alias",
  ];
  return order.map((id) => ({
    id,
    ...SITE_TYPE_FRIENDLY[id],
    notice: SITE_TYPE_FRIENDLY[id].notice,
    flag: WORDOPS_SITE_TYPES.find((t) => t.id === id)?.flag ?? "",
  }));
}

export function getExtraFlagOptions() {
  return WORDOPS_EXTRA_FLAGS.map((f) => ({
    ...f,
    friendlyLabel:
      f.id === "hsts"
        ? "Forçar HTTPS (HSTS)"
        : f.id === "ngxblocker"
          ? "Bloquear bots maliciosos"
          : "Criar estrutura sem instalar WordPress",
  }));
}
