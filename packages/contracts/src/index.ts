import { z } from "zod";

export * from "./wordops-site-catalog.js";
export * from "./wordops-php-resolve.js";
export * from "./wordops-site-manage.js";
export * from "./wordops-site-onboarding.js";
export * from "./site-migrate-onboarding.js";
export * from "./wordops-server-catalog.js";
export * from "./wordops-server-onboarding.js";
export * from "./wordops-dashboard-catalog.js";
export * from "./backup-policy.js";
export * from "./backup-center.js";
export * from "./dns-doctor.js";
export * from "./email.js";
export * from "./job-labels.js";
export * from "./security-center.js";
export * from "./wordpress-center.js";
export * from "./staging-center.js";
export * from "./performance-center.js";
export * from "./playbooks.js";
export * from "./alerts.js";

export const OperationKeys = {
  ServerConnectionTest: "server.connection.test",
  ServerSyncInventory: "server.inventory.sync",
  ServerHealthCollect: "server.health.collect",
  ServerStackAction: "server.stack.action",
  ServerMaintenanceRun: "server.maintenance.run",
  ServerSystemUpdate: "server.system.update",
  ServerMetricsCollect: "server.metrics.collect",
  ServerWordOpsInstall: "server.wordops.install",
  ServerWordOpsDashboardRecover: "server.wordops.dashboard.recover",
  ServerStackMigrate: "server.stack.migrate",
  ServerUfwConfigure: "server.ufw.configure",
  ServerSecurityScan: "server.security.scan",
  ServerPlaybookRun: "server.playbook.run",
  ServerDelete: "server.delete",
  ServerReboot: "server.reboot",
  ServerStackRestart: "server.stack.restart",
  SiteInfo: "site.info",
  SiteCreate: "site.create",
  SiteManage: "site.manage",
  SiteBackup: "site.backup",
  SiteRestore: "site.restore",
  SiteRollback: "site.rollback",
  SiteClone: "site.clone",
  SiteDelete: "site.delete",
  SiteUpdateDomain: "site.update.domain",
  SiteFtpUserCreate: "site.ftp.user.create",
  SiteFtpUserDelete: "site.ftp.user.delete",
  SiteMigrateFtp: "site.migrate.ftp",
  SiteEmailDomainProvision: "site.email.domain.provision",
  SiteEmailDnsPublish: "site.email.dns.publish",
  SiteEmailMailboxCreate: "site.email.mailbox.create",
  SiteEmailMailboxDelete: "site.email.mailbox.delete",
  SiteEmailHealthCheck: "site.email.health.check",
  SiteWpInventory: "site.wp.inventory",
  SiteWpUpdate: "site.wp.update",
} as const;

export type OperationKey = (typeof OperationKeys)[keyof typeof OperationKeys];

const domainRegex = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/** Campos opcionais: "" / só espaços viram undefined (evita falha de min() no create). */
const optionalTrimmedString = (schema: z.ZodString) =>
  z.preprocess((value) => {
    if (value == null) return undefined;
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
  }, schema.optional());

export const serverConnectionTestInputSchema = z.object({
  serverId: z.string().uuid(),
});

export type ServerConnectionTestInput = z.infer<typeof serverConnectionTestInputSchema>;

export const serverStackComponentSchema = z.enum([
  "all",
  "web",
  "admin",
  "utils",
  "nginx",
  "php",
  "php74",
  "php80",
  "php81",
  "php82",
  "php83",
  "mysql",
  "redis",
  "wpcli",
  "phpmyadmin",
  "composer",
  "netdata",
  "dashboard",
  "adminer",
  "fail2ban",
  "proftpd",
  "ngxblocker",
  "ufw",
  "brotli",
  "sendmail",
  "mysqltuner",
]);

export const serverStackActionKindSchema = z.enum([
  "install",
  "remove",
  "purge",
  "upgrade",
  "restart",
  "reload",
  "start",
  "stop",
  "status",
]);

export const serverStackInputSchema = z.object({
  serverId: z.string().uuid(),
  action: serverStackActionKindSchema,
  components: z.array(serverStackComponentSchema).min(1),
  force: z.boolean().optional(),
});

export type ServerStackInput = z.infer<typeof serverStackInputSchema>;

export const serverHealthCollectInputSchema = z.object({
  serverId: z.string().uuid(),
});

export const serverMaintenanceInputSchema = z.object({
  serverId: z.string().uuid(),
});

export const serverSystemUpdateInputSchema = z.object({
  serverId: z.string().uuid(),
});

export const serverMetricsCollectInputSchema = z.object({
  serverId: z.string().uuid(),
});

export const serverWordOpsInstallInputSchema = z.object({
  serverId: z.string().uuid(),
  adminEmail: z.string().email().optional(),
});

/** Recuperação do admin WordOps (:22222). reset = wo secure --auth (doc WordOps); capture = reinstala dashboard e lê saída. */
export const serverWordOpsDashboardRecoverInputSchema = z.object({
  serverId: z.string().uuid(),
  mode: z.enum(["reset", "capture"]).default("reset"),
  username: z.string().min(1).max(64).optional(),
  password: z.string().min(8).max(128).optional(),
});

export type ServerWordOpsDashboardRecoverInput = z.infer<typeof serverWordOpsDashboardRecoverInputSchema>;

export const serverStackMigrateInputSchema = z.object({
  serverId: z.string().uuid(),
  target: z.enum(["mariadb"]).default("mariadb"),
});

export const serverUfwConfigureInputSchema = z.object({
  serverId: z.string().uuid(),
  ports: z.array(z.number().int().min(1).max(65535)).optional(),
});

export const serverSecurityScanInputSchema = z.object({
  serverId: z.string().uuid(),
});

export type ServerSecurityScanInput = z.infer<typeof serverSecurityScanInputSchema>;

export const onboardingStepPatchSchema = z.object({
  completedSteps: z.array(z.string()).optional(),
  skippedSteps: z.array(z.string()).optional(),
  stepOrder: z.array(z.string()).optional(),
});

export const siteCreateTypeSchema = z.enum([
  "html",
  "php",
  "mysql",
  "wp",
  "wpfc",
  "wpredis",
  "wpsc",
  "wprocket",
  "wpce",
  "proxy",
  "alias",
]);

export const siteCreateInputSchema = z
  .object({
    serverId: z.string().uuid(),
    domain: z.string().min(3).max(253).regex(domainRegex),
    siteType: siteCreateTypeSchema,
    multisite: z.enum(["none", "subdir", "subdomain"]).optional().default("none"),
    phpVersion: z.enum(["default", "74", "80", "81", "82", "83", "84"]).optional().default("84"),
    sslMode: z
      .enum(["none", "letsencrypt", "letsencrypt_dns_cf", "letsencrypt_wildcard_cf"])
      .optional()
      .default("letsencrypt"),
    hsts: z.boolean().optional(),
    ngxblocker: z.boolean().optional(),
    vhostOnly: z.boolean().optional(),
    proxyTarget: optionalTrimmedString(z.string().max(120)),
    aliasTarget: optionalTrimmedString(z.string().max(253)),
    cloudflareApiKey: optionalTrimmedString(z.string().min(8, "Chave Cloudflare muito curta").max(256)),
    cloudflareEmail: optionalTrimmedString(
      z.string().email({ message: "E-mail Cloudflare inválido" }),
    ),
    wpUser: optionalTrimmedString(z.string().min(1).max(60)),
    wpPass: optionalTrimmedString(
      z.string().min(8, "Senha do WordPress deve ter pelo menos 8 caracteres (ou deixe em branco)").max(128),
    ),
    wpEmail: optionalTrimmedString(z.string().email({ message: "E-mail do WordPress inválido" })),
  })
  .superRefine((data, ctx) => {
    if (data.siteType === "proxy" && !data.proxyTarget) {
      ctx.addIssue({
        code: "custom",
        message: "Informe o destino do proxy (ex: 127.0.0.1:3000)",
        path: ["proxyTarget"],
      });
    }
    if (data.siteType === "alias" && !data.aliasTarget) {
      ctx.addIssue({
        code: "custom",
        message: "Informe o domínio de destino do alias",
        path: ["aliasTarget"],
      });
    }
    const needsCf = data.sslMode === "letsencrypt_dns_cf" || data.sslMode === "letsencrypt_wildcard_cf";
    if (needsCf && (!data.cloudflareApiKey || !data.cloudflareEmail)) {
      ctx.addIssue({
        code: "custom",
        message: "Modo Cloudflare requer Global API Key e e-mail da conta",
        path: ["cloudflareApiKey"],
      });
    }
    if (data.hsts && data.sslMode === "none") {
      ctx.addIssue({ code: "custom", message: "HSTS requer SSL ativo", path: ["hsts"] });
    }
  });

export type SiteCreateInput = z.infer<typeof siteCreateInputSchema>;

/** Clone site → staging subdomain ou novo domínio no mesmo servidor. */
export const siteCloneInputSchema = z
  .object({
    siteId: z.string().uuid(),
    targetDomain: z.string().min(3).max(253).regex(domainRegex, "Domínio inválido"),
    asStaging: z.boolean().optional().default(true),
  })
  .superRefine((data, ctx) => {
    // Validação de igualdade source/target ocorre na API (precisa do domínio atual).
    if (!data.targetDomain.trim()) {
      ctx.addIssue({ code: "custom", message: "Informe o domínio de destino", path: ["targetDomain"] });
    }
  });

export type SiteCloneInput = z.infer<typeof siteCloneInputSchema>;

/**
 * Rollback: atalho sobre SiteRestore (modo full) usando o backup mais recente,
 * ou um caminho explícito. O worker resolve o backup se backupPath for omitido.
 */
export const siteRollbackInputSchema = z.object({
  siteId: z.string().uuid(),
  backupPath: z
    .string()
    .min(10)
    .max(512)
    .regex(/^\/var\/backups\/opspanel\/[a-z0-9.-]+\/[^/]+$/i, "Caminho de backup inválido")
    .optional(),
});

export type SiteRollbackInput = z.infer<typeof siteRollbackInputSchema>;

export const siteInfoInputSchema = z.object({
  siteId: z.string().uuid(),
});

export const siteWpInventoryInputSchema = z.object({
  siteId: z.string().uuid(),
});

export type SiteWpInventoryInput = z.infer<typeof siteWpInventoryInputSchema>;

const wpUpdateTargetSchema = z.union([
  z.literal("core"),
  z.literal("plugins"),
  z.literal("themes"),
  z.string().min(1).max(128),
]);

export const siteWpUpdateInputSchema = z.object({
  siteId: z.string().uuid(),
  targets: z.array(wpUpdateTargetSchema).min(1),
});

export type SiteWpUpdateInput = z.infer<typeof siteWpUpdateInputSchema>;

export const siteManageActionSchema = z.enum([
  "enable",
  "disable",
  "letsencrypt",
  "letsencrypt_dns_cf",
  "update_wpfc",
  "update_wpredis",
  "update_wprocket",
  "update_wpsc",
  "update_wpce",
  "update_php81",
  "update_php82",
  "update_php83",
  "update_php84",
]);

export const siteManageInputSchema = z
  .object({
    siteId: z.string().uuid(),
    action: siteManageActionSchema,
    cloudflareApiKey: z.string().min(8).max(256).optional(),
    cloudflareEmail: z
      .string()
      .refine((v) => !v || /^[^\s@]+@[^\s@]+$/.test(v))
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.action === "letsencrypt_dns_cf" && (!data.cloudflareApiKey || !data.cloudflareEmail)) {
      ctx.addIssue({ code: "custom", message: "Cloudflare requer API Key e e-mail", path: ["cloudflareApiKey"] });
    }
  });

export const siteFtpUserCreateInputSchema = z.object({
  siteId: z.string().uuid(),
  username: z
    .string()
    .min(2)
    .max(32)
    .regex(/^[a-z][a-z0-9_-]*$/i),
  password: z.string().min(8).max(128).optional(),
  ensureProftpd: z.boolean().optional().default(true),
});

export const siteFtpUserDeleteInputSchema = z.object({
  siteId: z.string().uuid(),
  ftpUserId: z.string().uuid(),
  username: z.string().min(2).max(32),
});

export const siteDeleteInputSchema = z.object({
  siteId: z.string().uuid(),
  confirmDomain: z.string().min(3).max(253),
});

export const siteUpdateDomainInputSchema = z.object({
  siteId: z.string().uuid(),
  newDomain: z.string().min(3).max(253).regex(domainRegex, "Domínio inválido"),
});

export const siteMigrateSourceProtocolSchema = z.enum(["ftp", "ftps", "sftp"]);

export const siteMigrateDbModeSchema = z.enum([
  "none",
  "hosting_mysql",
  "phpmyadmin_export",
  "auto_wpconfig",
  /** @deprecated use hosting_mysql */
  "remote",
  /** @deprecated use phpmyadmin_export */
  "inline_sql",
]);

export const siteMigrateFtpInputSchema = z
  .object({
    siteId: z.string().uuid(),
    sourceProtocol: siteMigrateSourceProtocolSchema,
    sourceHost: z.string().min(1).max(255),
    sourcePort: z.number().int().min(1).max(65535).optional(),
    sourceUsername: z.string().min(1).max(128),
    sourcePassword: z.string().min(1).max(256),
    sourcePath: z.string().max(512).optional().default("/"),
    oldUrl: z.string().max(512).optional(),
    dbMode: siteMigrateDbModeSchema.optional().default("hosting_mysql"),
    dbHost: z.string().max(255).optional(),
    dbPort: z.number().int().min(1).max(65535).optional(),
    dbName: z.string().max(128).optional(),
    dbUser: z.string().max(128).optional(),
    dbPassword: z.string().max(256).optional(),
    sqlDumpBase64: z.string().max(70_000_000).optional(),
  })
  .superRefine((data, ctx) => {
    const dbMode = data.dbMode === "remote" ? "hosting_mysql" : data.dbMode === "inline_sql" ? "phpmyadmin_export" : data.dbMode;
    if (dbMode === "hosting_mysql") {
      if (!data.dbHost || !data.dbName || !data.dbUser || !data.dbPassword) {
        ctx.addIssue({
          code: "custom",
          message: "Informe host, banco, usuário e senha do MySQL da hospedagem",
          path: ["dbHost"],
        });
      }
    }
    if (dbMode === "phpmyadmin_export" && !data.sqlDumpBase64) {
      ctx.addIssue({
        code: "custom",
        message: "Envie o arquivo .sql exportado do phpMyAdmin",
        path: ["sqlDumpBase64"],
      });
    }
  });

export type SiteMigrateFtpInput = z.infer<typeof siteMigrateFtpInputSchema>;

export const siteMigrateSourceProbeSchema = z.object({
  sourceProtocol: siteMigrateSourceProtocolSchema,
  sourceHost: z.string().min(1).max(255),
  sourcePort: z.number().int().min(1).max(65535).optional(),
  sourceUsername: z.string().min(1).max(128),
  sourcePassword: z.string().min(1).max(256),
  sourcePath: z.string().max(512).optional().default("/"),
});

export type SiteMigrateSourceProbeInput = z.infer<typeof siteMigrateSourceProbeSchema>;

export const serverRebootInputSchema = z.object({
  serverId: z.string().uuid(),
  confirm: z.literal(true),
});

export const JobStatus = {
  Queued: "queued",
  Validating: "validating",
  Running: "running",
  Verifying: "verifying",
  Succeeded: "succeeded",
  Failed: "failed",
  Cancelled: "cancelled",
  TimedOut: "timed_out",
} as const;

export type JobStatusValue = (typeof JobStatus)[keyof typeof JobStatus];

export const OrgRole = {
  Owner: "owner",
  Admin: "admin",
  Operator: "operator",
  Developer: "developer",
  Viewer: "viewer",
} as const;

export type OrgRoleValue = (typeof OrgRole)[keyof typeof OrgRole];

import type { StackComponentState } from "./wordops-server-catalog.js";

export interface ConnectionHealthHint {
  stackComponents?: StackComponentState[];
  uptimeSeconds?: number;
  collectedAt?: string;
}

export interface ConnectionResult {
  ok: boolean;
  latencyMs?: number;
  osRelease?: string;
  wordopsVersion?: string;
  healthHint?: ConnectionHealthHint;
  errorCode?: string;
  errorMessage?: string;
}

export interface ExecutionEvent {
  sequence: number;
  type: "progress" | "log" | "error" | "done";
  message: string;
  progress?: number;
  metadata?: Record<string, string>;
}

export interface ExecutionResult {
  ok: boolean;
  connection?: ConnectionResult;
  events?: ExecutionEvent[];
}

export interface TypedServerOperation {
  key: OperationKey;
  input: Record<string, unknown>;
}

export interface RemoteExecutor {
  testConnection(serverId: string, organizationId: string): Promise<ConnectionResult>;
  executeOperation(
    serverId: string,
    organizationId: string,
    operation: TypedServerOperation,
  ): Promise<ExecutionResult>;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    requestId: string;
  };
}
