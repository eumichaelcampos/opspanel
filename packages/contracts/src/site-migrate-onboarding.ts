import type { SiteMigrateFtpInput } from "./index.js";

export type SiteMigrateStepId = "site" | "source" | "database" | "review";

export interface SiteMigrateSavedDraft {
  sourceProtocol: SiteMigrateDraft["sourceProtocol"];
  sourceHost: string;
  sourcePort: string;
  sourceUsername: string;
  sourcePassword: string;
  sourcePath: string;
  oldUrl: string;
  dbMode: SiteMigrateDraft["dbMode"];
  dbHost: string;
  dbPort: string;
  dbName: string;
  dbUser: string;
  dbPassword: string;
}

export interface SiteMigrateTarget {
  id: string;
  domain: string;
  siteType?: string | null;
  status: string;
  server: { id: string; name: string; host: string };
  webroot: string;
  isWordPress: boolean;
  /** Multisite do destino WordOps: none | subdir | subdomain */
  multisite?: "none" | "subdir" | "subdomain" | "multisite";
  destDatabase: {
    host: string;
    name: string;
    user: string;
    hasPassword: boolean;
  } | null;
  phpMyAdminUrl: string;
  adminerUrl: string;
  lastDraft?: SiteMigrateSavedDraft | null;
}

export interface SiteMigrateDraft {
  siteId: string;
  sourceProtocol: "ftp" | "ftps" | "sftp";
  sourceHost: string;
  sourcePort: string;
  sourceUsername: string;
  sourcePassword: string;
  sourcePath: string;
  oldUrl: string;
  dbMode: "none" | "hosting_mysql" | "phpmyadmin_export" | "auto_wpconfig";
  dbHost: string;
  dbPort: string;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  sqlFileName: string;
  sqlDumpBase64: string;
}

export const DEFAULT_SITE_MIGRATE_DRAFT: SiteMigrateDraft = {
  siteId: "",
  sourceProtocol: "ftp",
  sourceHost: "",
  sourcePort: "",
  sourceUsername: "",
  sourcePassword: "",
  sourcePath: "/",
  oldUrl: "",
  dbMode: "auto_wpconfig",
  dbHost: "",
  dbPort: "3306",
  dbName: "",
  dbUser: "",
  dbPassword: "",
  sqlFileName: "",
  sqlDumpBase64: "",
};

export const SITE_MIGRATE_STEPS: { id: SiteMigrateStepId; label: string; description: string }[] = [
  {
    id: "site",
    label: "Site destino",
    description: "Selecione o site já criado no WordOps que receberá a migração",
  },
  { id: "source", label: "Origem FTP", description: "Credenciais FTP/SFTP da hospedagem de origem" },
  {
    id: "database",
    label: "Banco de dados",
    description: "MySQL da hospedagem ou exportação via phpMyAdmin",
  },
  { id: "review", label: "Revisão", description: "Confirme pasta destino, banco MariaDB e origem" },
];

export function siteMigrateMultisiteLabel(multisite?: SiteMigrateTarget["multisite"]): string {
  if (multisite === "subdir") return "Multisite (subpastas)";
  if (multisite === "subdomain") return "Multisite (subdomínios)";
  if (multisite === "multisite") return "Multisite";
  return "Site único";
}

export function isMultisiteTarget(multisite?: SiteMigrateTarget["multisite"]): boolean {
  return multisite === "subdir" || multisite === "subdomain" || multisite === "multisite";
}

export function defaultSiteWebroot(domain: string, siteType?: string | null): string {
  const d = domain.toLowerCase();
  const isWp = siteType?.startsWith("wp") || siteType === "mysql";
  return isWp ? `/var/www/${d}/htdocs` : `/var/www/${d}`;
}

export function wordOpsDashboardUrl(host: string, path: string): string {
  return `https://${host}:22222${path}`;
}

export function validateSiteMigrateStep(
  step: SiteMigrateStepId,
  draft: SiteMigrateDraft,
  target?: SiteMigrateTarget | null,
): string | null {
  switch (step) {
    case "site":
      if (!draft.siteId) return "Selecione o site de destino";
      if (!target) return "Site de destino não encontrado";
      return null;
    case "source":
      if (!draft.sourceHost.trim()) return "Informe o host FTP/SFTP";
      if (!draft.sourceUsername.trim()) return "Informe o usuário";
      if (!draft.sourcePassword) return "Informe a senha";
      return null;
    case "database":
      if (draft.dbMode === "hosting_mysql") {
        if (!draft.dbHost.trim()) return "Informe o host MySQL da hospedagem";
        if (!draft.dbName.trim()) return "Informe o nome do banco";
        if (!draft.dbUser.trim()) return "Informe o usuário MySQL";
        if (!draft.dbPassword) return "Informe a senha MySQL";
      }
      if (draft.dbMode === "phpmyadmin_export" && !draft.sqlDumpBase64) {
        return "Exporte o banco no phpMyAdmin da hospedagem e envie o arquivo .sql";
      }
      if (isMultisiteTarget(target?.multisite) && !draft.oldUrl.trim()) {
        return "Em Multisite informe a URL antiga da rede (ex.: https://site-antigo.com.br) para atualizar wp_blogs e DOMAIN_CURRENT_SITE";
      }
      return null;
    case "review":
      return null;
    default:
      return null;
  }
}

function normalizeDbMode(mode: SiteMigrateDraft["dbMode"]): SiteMigrateFtpInput["dbMode"] {
  return mode;
}

export function buildSiteMigratePayload(draft: SiteMigrateDraft): SiteMigrateFtpInput {
  const port = draft.sourcePort.trim() ? Number.parseInt(draft.sourcePort, 10) : undefined;
  const dbPort = draft.dbPort.trim() ? Number.parseInt(draft.dbPort, 10) : undefined;

  return {
    siteId: draft.siteId,
    sourceProtocol: draft.sourceProtocol,
    sourceHost: draft.sourceHost.trim(),
    sourcePort: port,
    sourceUsername: draft.sourceUsername.trim(),
    sourcePassword: draft.sourcePassword,
    sourcePath: draft.sourcePath.trim() || "/",
    oldUrl: draft.oldUrl.trim() || undefined,
    dbMode: normalizeDbMode(draft.dbMode),
    dbHost: draft.dbHost.trim() || undefined,
    dbPort: dbPort,
    dbName: draft.dbName.trim() || undefined,
    dbUser: draft.dbUser.trim() || undefined,
    dbPassword: draft.dbPassword || undefined,
    sqlDumpBase64: draft.sqlDumpBase64 || undefined,
  };
}

export function siteMigrateDraftLooksFilled(draft: Pick<SiteMigrateDraft, "sourceHost" | "sourceUsername" | "sourcePassword">): boolean {
  return Boolean(draft.sourceHost.trim() && draft.sourceUsername.trim() && draft.sourcePassword);
}

export function siteMigrateDraftFromJobInput(input: Record<string, unknown> | null | undefined): SiteMigrateSavedDraft | null {
  if (!input || typeof input.sourceHost !== "string" || !input.sourceHost.trim()) return null;
  const protocol = input.sourceProtocol;
  const dbMode = input.dbMode;
  return {
    sourceProtocol: protocol === "ftps" || protocol === "sftp" || protocol === "ftp" ? protocol : "ftp",
    sourceHost: String(input.sourceHost ?? ""),
    sourcePort: input.sourcePort != null ? String(input.sourcePort) : "",
    sourceUsername: String(input.sourceUsername ?? ""),
    sourcePassword: String(input.sourcePassword ?? ""),
    sourcePath: String(input.sourcePath ?? "/") || "/",
    oldUrl: String(input.oldUrl ?? ""),
    dbMode:
      dbMode === "none" || dbMode === "phpmyadmin_export" || dbMode === "auto_wpconfig" || dbMode === "hosting_mysql"
        ? dbMode
        : "hosting_mysql",
    dbHost: String(input.dbHost ?? ""),
    dbPort: input.dbPort != null ? String(input.dbPort) : "3306",
    dbName: String(input.dbName ?? ""),
    dbUser: String(input.dbUser ?? ""),
    dbPassword: String(input.dbPassword ?? ""),
  };
}

export function siteMigrateProgress(step: SiteMigrateStepId): number {
  const idx = SITE_MIGRATE_STEPS.findIndex((s) => s.id === step);
  if (idx < 0) return 0;
  return Math.round(((idx + 1) / SITE_MIGRATE_STEPS.length) * 100);
}

export function siteMigrateDbModeLabel(mode: SiteMigrateDraft["dbMode"]): string {
  switch (mode) {
    case "auto_wpconfig":
      return "Detectar do wp-config (recomendado)";
    case "hosting_mysql":
      return "Credenciais MySQL da hospedagem";
    case "phpmyadmin_export":
      return "Arquivo .sql (phpMyAdmin)";
    case "none":
      return "Sem banco (só arquivos)";
    default:
      return mode;
  }
}

/** Texto de ajuda para o usuário quando a importação do banco falha. */
export function siteMigrateDbRecoverySteps(vpsIp?: string | null): string[] {
  const ip = vpsIp?.trim() || "o IP do servidor WordOps (painel → Servidores)";
  return [
    `No cPanel da hospedagem antiga, abra Remote MySQL e libere o IP ${ip}.`,
    "Aguarde 1–2 minutos e clique em Tentar novamente.",
    "Se ainda falhar: no phpMyAdmin da origem, exporte o banco em SQL e na migração escolha Arquivo .sql.",
  ];
}

export function isSiteMigrateDbFailure(message?: string | null, errorCode?: string | null): boolean {
  if (errorCode?.startsWith("MIGRATE_DB_")) return true;
  if (!message) return false;
  return /banco|MySQL|MariaDB|Remote MySQL|sql|database|wp-config|importar/i.test(message);
}
