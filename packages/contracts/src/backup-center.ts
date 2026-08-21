/** Backup Pro: hub org-wide e metadados de catálogo. */

import type { BackupContents, BackupSchedule } from "./backup-policy.js";

export type BackupIntegrity = "ok" | "warning" | "unknown";

export type BackupLocation = "local" | "drive" | "both";

export type BackupHubEntry = {
  siteId: string;
  domain: string;
  serverId: string;
  serverName?: string;
  path: string;
  timestamp: string;
  hasDatabase: boolean;
  hasFiles: boolean;
  filesSizeBytes: number;
  location: BackupLocation;
  driveFolderId?: string;
  integrity?: BackupIntegrity;
};

export type BackupSiteSummary = {
  siteId: string;
  domain: string;
  serverId: string;
  serverName?: string;
  contents: BackupContents;
  schedule: BackupSchedule;
  keepLocal: number;
  uploadToDrive: boolean;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  backupCount: number;
  latestTimestamp?: string | null;
  latestSizeBytes?: number | null;
  listError?: string | null;
};

export type BackupHubResponse = {
  summary: {
    sites: number;
    withSchedule: number;
    totalBackups: number;
    driveCopies: number;
    integrityWarnings: number;
  };
  recent: BackupHubEntry[];
  sites: BackupSiteSummary[];
};

export function backupIntegrityLabel(integrity?: BackupIntegrity): string {
  if (integrity === "ok") return "Integridade OK";
  if (integrity === "warning") return "Falha no teste de arquivo";
  return "Não verificado";
}
