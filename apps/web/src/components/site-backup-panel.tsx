"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Cloud, Database, FileArchive, Loader2, RotateCcw, Shield, AlertTriangle, Save } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";

type BackupEntry = {
  path: string;
  timestamp: string;
  hasDatabase: boolean;
  hasFiles?: boolean;
  filesSizeBytes: number;
  location?: "local" | "drive" | "both";
  driveFolderId?: string;
};

type BackupPolicy = {
  contents: "files_and_database" | "files_only" | "database_only";
  keepLocal: number;
  schedule: "off" | "daily" | "every_12h" | "weekly";
  scheduleHour: number;
  uploadToDrive: boolean;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  driveConnected?: boolean;
};

type RestoreTarget = { path?: string; driveFolderId?: string };

type Props = {
  siteId: string;
  domain: string;
  disabled?: boolean;
  backupPending?: boolean;
  restorePending?: boolean;
  restoreTargetPath?: string | null;
  onBackup: () => void;
  onRestore: (target: RestoreTarget) => void;
};

function formatBackupTimestamp(ts: string) {
  if (!/^\d{14}$/.test(ts)) return ts;
  const y = ts.slice(0, 4);
  const mo = ts.slice(4, 6);
  const d = ts.slice(6, 8);
  const h = ts.slice(8, 10);
  const mi = ts.slice(10, 12);
  return `${d}/${mo}/${y} ${h}:${mi}`;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function locationLabel(location?: BackupEntry["location"]) {
  if (location === "drive") return "Google Drive";
  if (location === "both") return "Servidor + Drive";
  return "Servidor";
}

export function SiteBackupPanel({
  siteId,
  domain,
  disabled = false,
  backupPending = false,
  restorePending = false,
  restoreTargetPath = null,
  onBackup,
  onRestore,
}: Props) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<RestoreTarget | null>(null);
  const [contents, setContents] = useState<BackupPolicy["contents"]>("files_and_database");
  const [keepLocal, setKeepLocal] = useState(7);
  const [schedule, setSchedule] = useState<BackupPolicy["schedule"]>("off");
  const [scheduleHour, setScheduleHour] = useState(3);
  const [uploadToDrive, setUploadToDrive] = useState(false);
  const [policyMsg, setPolicyMsg] = useState<string | null>(null);

  const {
    data: backupList,
    isLoading: backupsLoading,
    isError: backupsError,
    error: backupsErrorObj,
    refetch: refetchBackups,
  } = useQuery({
    queryKey: ["site-backups", siteId],
    queryFn: () => apiFetch<{ backups: BackupEntry[]; policy?: BackupPolicy }>(`/sites/${siteId}/backups`),
    staleTime: 15_000,
    refetchOnMount: "always",
  });

  useEffect(() => {
    const policy = backupList?.policy;
    if (!policy) return;
    setContents(policy.contents);
    setKeepLocal(policy.keepLocal);
    setSchedule(policy.schedule);
    setScheduleHour(policy.scheduleHour);
    setUploadToDrive(policy.uploadToDrive);
  }, [backupList?.policy]);

  const savePolicy = useMutation({
    mutationFn: () =>
      apiFetch<BackupPolicy>(`/sites/${siteId}/backup-policy`, {
        method: "PATCH",
        body: JSON.stringify({ contents, keepLocal, schedule, scheduleHour, uploadToDrive }),
      }),
    onSuccess: () => {
      setPolicyMsg("Política de backup salva.");
      void qc.invalidateQueries({ queryKey: ["site-backups", siteId] });
    },
    onError: (e) => setPolicyMsg(e instanceof Error ? e.message : "Falha ao salvar política"),
  });

  const backups = backupList?.backups ?? [];
  const policy = backupList?.policy;

  function confirmRestore() {
    if (!confirm) return;
    onRestore(confirm);
    setConfirm(null);
  }

  return (
    <div className="space-y-5">
      <div className="rounded-card border border-accent/20 bg-accent/5 px-4 py-3 text-sm text-muted">
        <p className="flex items-start gap-2">
          <Shield className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <span>
            Backups locais ficam em{" "}
            <code className="rounded bg-ink/5 px-1 text-[11px]">/var/backups/opspanel/{domain}/</code>. Antes de
            restaurar, o OpsPanel cria um backup de segurança. Cópias no Google Drive aliviam o disco do servidor.
          </span>
        </p>
      </div>

      <section className="rounded-card border border-ink/10 bg-white/70 p-4 space-y-4">
        <h3 className="text-sm font-semibold text-ink">Política de backup</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Conteúdo</span>
            <select
              className="w-full rounded-card border border-ink/20 bg-white px-3 py-2"
              value={contents}
              onChange={(e) => setContents(e.target.value as BackupPolicy["contents"])}
              disabled={disabled}
            >
              <option value="files_and_database">Arquivos + banco</option>
              <option value="files_only">Somente arquivos</option>
              <option value="database_only">Somente banco</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Manter no servidor</span>
            <input
              type="number"
              min={0}
              max={30}
              className="w-full rounded-card border border-ink/20 bg-white px-3 py-2"
              value={keepLocal}
              onChange={(e) => setKeepLocal(Number(e.target.value))}
              disabled={disabled}
            />
            <span className="mt-1 block text-[11px] text-muted">0 envia só ao Drive (se conectado) e limpa o disco.</span>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Agendamento</span>
            <select
              className="w-full rounded-card border border-ink/20 bg-white px-3 py-2"
              value={schedule}
              onChange={(e) => setSchedule(e.target.value as BackupPolicy["schedule"])}
              disabled={disabled}
            >
              <option value="off">Somente manual</option>
              <option value="daily">Todo dia</option>
              <option value="every_12h">A cada 12 horas</option>
              <option value="weekly">Toda semana</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Horário (Brasília)</span>
            <select
              className="w-full rounded-card border border-ink/20 bg-white px-3 py-2"
              value={scheduleHour}
              onChange={(e) => setScheduleHour(Number(e.target.value))}
              disabled={disabled || schedule === "off"}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:00
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={uploadToDrive}
            onChange={(e) => setUploadToDrive(e.target.checked)}
            disabled={disabled}
          />
          <span>
            Enviar cópia para o Google Drive
            {!policy?.driveConnected ? (
              <>
                {" "}
                <a href="/settings/account" className="text-accent hover:underline">
                  (conectar conta)
                </a>
              </>
            ) : null}
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-card border border-ink/15 bg-white px-4 py-2 text-sm font-medium hover:bg-ink/5 disabled:opacity-60"
            disabled={disabled || savePolicy.isPending}
            onClick={() => savePolicy.mutate()}
          >
            {savePolicy.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar política
          </button>
          {policy?.nextRunAt && schedule !== "off" ? (
            <p className="text-xs text-muted">
              Próximo automático: {new Date(policy.nextRunAt).toLocaleString("pt-BR")}
            </p>
          ) : null}
        </div>
        {policyMsg ? <p className="text-sm text-muted">{policyMsg}</p> : null}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-ink">Backups do site</h3>
          <p className="text-sm text-muted">{backups.length} backup(s)</p>
        </div>
        <button
          type="button"
          disabled={disabled || backupPending || restorePending}
          onClick={onBackup}
          className={cn(
            "inline-flex items-center gap-2 rounded-card border px-4 py-2.5 text-sm font-medium transition disabled:opacity-60",
            backupPending
              ? "border-accent bg-accent/10 text-accent ring-1 ring-accent/30"
              : "border-accent/40 bg-accent text-white hover:bg-accent/90",
          )}
        >
          {backupPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Criando…
            </>
          ) : (
            <>
              <Archive className="h-4 w-4" />
              Novo backup
            </>
          )}
        </button>
      </div>

      {backupsLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando backups…
        </p>
      ) : backupsError ? (
        <div className="rounded-card border border-danger/30 bg-danger/5 px-4 py-3 text-sm">
          <p className="text-danger">Não foi possível listar os backups.</p>
          <p className="mt-1 text-xs text-muted">{(backupsErrorObj as Error).message}</p>
          <button type="button" className="mt-2 text-xs text-accent hover:underline" onClick={() => void refetchBackups()}>
            Tentar novamente
          </button>
        </div>
      ) : backups.length === 0 ? (
        <div className="rounded-card border border-white/80 bg-white/60 px-4 py-6 text-center text-sm text-muted">
          Nenhum backup encontrado. Clique em <strong>Novo backup</strong> para criar o primeiro.
        </div>
      ) : (
        <ul className="space-y-2">
          {backups.map((entry, index) => {
            const isRestoring =
              restorePending &&
              (restoreTargetPath === entry.path || restoreTargetPath === entry.driveFolderId);
            return (
              <li
                key={`${entry.timestamp}-${entry.path || entry.driveFolderId}`}
                className={cn(
                  "flex flex-col gap-3 rounded-card border px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
                  isRestoring ? "border-warning/40 bg-warning/5" : "border-white/80 bg-white/80",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-ink">{formatBackupTimestamp(entry.timestamp)}</p>
                    {index === 0 ? (
                      <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
                        Mais recente
                      </span>
                    ) : null}
                    <span className="inline-flex items-center gap-1 rounded-full bg-ink/5 px-2 py-0.5 text-[10px] font-medium text-muted">
                      {entry.location === "drive" || entry.location === "both" ? (
                        <Cloud className="h-3 w-3" />
                      ) : (
                        <FileArchive className="h-3 w-3" />
                      )}
                      {locationLabel(entry.location)}
                    </span>
                    {entry.hasDatabase ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
                        <Database className="h-3 w-3" />
                        Banco
                      </span>
                    ) : null}
                    {entry.hasFiles !== false ? (
                      <span className="rounded-full bg-ink/5 px-2 py-0.5 text-[10px] font-medium text-muted">Arquivos</span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-muted">{formatSize(entry.filesSizeBytes)}</p>
                </div>
                <button
                  type="button"
                  disabled={disabled || backupPending || restorePending}
                  onClick={() =>
                    setConfirm({
                      path: entry.path || undefined,
                      driveFolderId: entry.driveFolderId,
                    })
                  }
                  className={cn(
                    "inline-flex shrink-0 items-center justify-center gap-2 rounded-card border px-4 py-2.5 text-sm font-semibold transition disabled:opacity-60",
                    isRestoring
                      ? "border-warning bg-warning/10 text-warning"
                      : "border-warning/50 bg-warning text-white hover:bg-warning/90",
                  )}
                >
                  {isRestoring ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Restaurando…
                    </>
                  ) : (
                    <>
                      <RotateCcw className="h-4 w-4" />
                      Restaurar
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {confirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-white/20 bg-white p-5 shadow-xl">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
              <div>
                <h4 className="font-semibold text-ink">Confirmar restauração</h4>
                <p className="mt-2 text-sm text-muted">
                  O site <strong>{domain}</strong> será substituído por este backup. Um backup de segurança será
                  criado antes.
                </p>
                <p className="mt-2 font-mono text-[11px] break-all text-muted">
                  {confirm.path || `Google Drive ${confirm.driveFolderId}`}
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-card border border-ink/15 px-4 py-2 text-sm text-muted hover:bg-ink/5"
                onClick={() => setConfirm(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-card bg-warning px-4 py-2 text-sm font-semibold text-white hover:bg-warning/90"
                onClick={confirmRestore}
              >
                <RotateCcw className="h-4 w-4" />
                Restaurar agora
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
