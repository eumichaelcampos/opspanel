import { z } from "zod";

export const backupContentsSchema = z.enum(["files_and_database", "files_only", "database_only"]);
export type BackupContents = z.infer<typeof backupContentsSchema>;

export const backupScheduleSchema = z.enum(["off", "daily", "every_12h", "weekly"]);
export type BackupSchedule = z.infer<typeof backupScheduleSchema>;

export const DEFAULT_BACKUP_POLICY = {
  contents: "files_and_database" as BackupContents,
  keepLocal: 7,
  schedule: "off" as BackupSchedule,
  scheduleHour: 3,
  uploadToDrive: false,
};

export const siteBackupPolicyPatchSchema = z.object({
  contents: backupContentsSchema.optional(),
  keepLocal: z.number().int().min(0).max(30).optional(),
  schedule: backupScheduleSchema.optional(),
  scheduleHour: z.number().int().min(0).max(23).optional(),
  uploadToDrive: z.boolean().optional(),
});

export const siteBackupInputSchema = z.object({
  siteId: z.string().uuid(),
  contents: backupContentsSchema.optional(),
  source: z.enum(["manual", "schedule", "safety"]).optional(),
});

export const siteRestoreInputSchema = z.object({
  siteId: z.string().uuid(),
  backupPath: z
    .string()
    .min(10)
    .max(512)
    .regex(/^\/var\/backups\/opspanel\/[a-z0-9.-]+\/[^/]+$/i, "Caminho de backup inválido")
    .optional(),
  driveFolderId: z.string().min(8).max(128).optional(),
}).refine((v) => Boolean(v.backupPath || v.driveFolderId), {
  message: "Informe o backup local ou o backup no Google Drive.",
});

/** Próxima execução em America/Sao_Paulo (UTC-3, sem horário de verão). */
export function computeNextBackupRun(
  schedule: BackupSchedule,
  hour: number,
  from: Date = new Date(),
): Date | null {
  if (schedule === "off") return null;
  const h = ((hour % 24) + 24) % 24;
  const fromMs = from.getTime();
  const spNow = new Date(fromMs - 3 * 3600_000);
  const y = spNow.getUTCFullYear();
  const mo = spNow.getUTCMonth();
  const d = spNow.getUTCDate();

  const atSp = (dayOffset: number, hr: number) =>
    new Date(Date.UTC(y, mo, d + dayOffset, hr + 3, 0, 0));

  const candidates: Date[] = [];
  if (schedule === "daily") {
    candidates.push(atSp(0, h), atSp(1, h));
  } else if (schedule === "every_12h") {
    const h2 = (h + 12) % 24;
    for (const day of [0, 1]) {
      candidates.push(atSp(day, h), atSp(day, h2));
    }
  } else {
    candidates.push(atSp(0, h), atSp(7, h));
  }

  const next = candidates
    .filter((c) => c.getTime() > fromMs)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  return next ?? null;
}

export function backupContentsLabel(contents: BackupContents): string {
  if (contents === "files_only") return "Somente arquivos";
  if (contents === "database_only") return "Somente banco";
  return "Arquivos + banco";
}

export function backupScheduleLabel(schedule: BackupSchedule): string {
  if (schedule === "daily") return "Todo dia";
  if (schedule === "every_12h") return "A cada 12 horas";
  if (schedule === "weekly") return "Toda semana";
  return "Somente manual";
}
