"use client";

import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { SiteFtpPanel, notifySiteFtpJobResult } from "@/components/site-ftp-panel";
import { SiteFileManager } from "@/components/site-file-manager";
import { SiteBackupPanel } from "@/components/site-backup-panel";
import { SiteDomainPanel } from "@/components/site-domain-panel";
import { SiteManagePanel, getManageActionTitle } from "@/components/site-manage-panel";
import { SiteDetailTabs, type SiteDetailTab } from "@/components/site-detail-tabs";
import { SiteCloudflarePanel } from "@/components/site-cloudflare-panel";
import { SiteEmailPanel } from "@/components/site-email-panel";
import { SiteDnsAlert } from "@/components/site-dns-alert";
import { SiteInventorySummary } from "@/components/site-inventory-summary";
import { OperationTerminal } from "@/components/operation-terminal";
import { SiteOpsResultBanner } from "@/components/site-ops-result-banner";
import { AppShell } from "@/components/app-shell";
import { JobTracker } from "@/components/job-tracker";
import { StatusBadge } from "@/components/status-badge";
import { apiFetch } from "@/lib/api";
import { formatObservedAt, SYNC_INTERVALS } from "@/lib/auto-sync";
import { useAutoSiteSync } from "@/lib/use-auto-site-sync";
import { ExternalLink, Globe, Loader2, Server, Trash2, Upload } from "lucide-react";
import type { StackComponentState } from "@/lib/server-health";

type SiteInfoSnapshot = {
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
  multisite?: "none" | "subdir" | "subdomain" | "multisite";
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
  lastBackup?: {
    path?: string;
    filesArchive?: string;
    databaseArchive?: string;
    createdAt?: string;
  };
};

type SiteDetail = {
  id: string;
  domain: string;
  status: string;
  siteType?: string | null;
  phpVersion?: string | null;
  cacheBackend?: string | null;
  isEnabled?: boolean | null;
  infoSnapshot?: SiteInfoSnapshot | null;
  lastObservedAt?: string | null;
  server: {
    id: string;
    name: string;
    host: string;
    port: number;
    stackComponents?: StackComponentState[];
    healthObservedAt?: string | null;
  };
  ftpUsers?: { id: string; username: string; homePath: string; createdAt: string; hasPassword: boolean }[];
};

type UpdateAction = {
  id: string;
  label: string;
  wo: string;
  needsCloudflare?: boolean;
  destructive?: boolean;
};

type OpsFeedback = {
  status: "success" | "error";
  title: string;
  message: string;
};

const OPS_JOB_OPERATIONS = new Set(["site.manage", "site.backup", "site.restore", "site.update.domain", "site.delete"]);

function dashboardUrl(host: string, path: string): string {
  return `https://${host}:22222${path}`;
}

function isWordPressSite(site: SiteDetail, info?: SiteInfoSnapshot): boolean {
  if (info?.isWordPress) return true;
  if (site.siteType && /^wp/i.test(site.siteType)) return true;
  return false;
}

function InfoRow({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <span className="text-sm text-muted">{label}</span>
      <span className={`text-sm font-medium ${mono ? "font-mono text-xs break-all text-right" : ""}`}>
        {value ?? "—"}
      </span>
    </div>
  );
}

export default function SiteDetailPageInner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [autologinTried, setAutologinTried] = useState(false);
  const [wpAutologinError, setWpAutologinError] = useState<string | null>(null);
  const [showDbPass, setShowDbPass] = useState(false);
  const [cfModal, setCfModal] = useState<{ action: string; label: string } | null>(null);
  const [cfKey, setCfKey] = useState("");
  const [cfEmail, setCfEmail] = useState("");
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteConfirmDomain, setDeleteConfirmDomain] = useState("");
  const [newDomain, setNewDomain] = useState("");
  const tabFromUrl = searchParams.get("tab");
  const initialTab: SiteDetailTab =
    tabFromUrl === "files" ||
    tabFromUrl === "database" ||
    tabFromUrl === "ops" ||
    tabFromUrl === "backup" ||
    tabFromUrl === "domain" ||
    tabFromUrl === "cloudflare" ||
    tabFromUrl === "email" ||
    tabFromUrl === "access" ||
    tabFromUrl === "danger" ||
    tabFromUrl === "overview"
      ? tabFromUrl
      : "overview";
  const [activeTab, setActiveTab] = useState<SiteDetailTab>(initialTab);
  const [opsJobActive, setOpsJobActive] = useState(false);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [restoreTargetPath, setRestoreTargetPath] = useState<string | null>(null);
  const [opsFeedback, setOpsFeedback] = useState<OpsFeedback | null>(null);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const { data: site, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["site", params.id],
    queryFn: () => apiFetch<SiteDetail>(`/sites/${params.id}`),
    refetchInterval: activeJobId ? 2000 : SYNC_INTERVALS.queryPollMs,
  });

  const { data: options } = useQuery({
    queryKey: ["sites-create-options"],
    queryFn: () => apiFetch<{ updateActions: UpdateAction[] }>("/sites/create-options"),
  });

  const info = site?.infoSnapshot ?? undefined;
  const ftpUsers = site?.ftpUsers ?? [];

  useAutoSiteSync({
    siteId: params.id,
    enabled: Boolean(site),
    lastObservedAt: site?.lastObservedAt,
    activeJobId,
  });

  const manageMutation = useMutation({
    mutationFn: (payload: { action: string; cloudflareApiKey?: string; cloudflareEmail?: string }) =>
      apiFetch<{ jobId: string }>(`/sites/${params.id}/manage`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: (r, variables) => {
      setCfModal(null);
      setPendingActionId(variables.action);
      setOpsJobActive(true);
      setOpsFeedback(null);
      setActiveJobId(r.jobId);
      setActiveTab("ops");
    },
  });

  const backupMutation = useMutation({
    mutationFn: () => apiFetch<{ jobId: string }>(`/sites/${params.id}/backup`, { method: "POST" }),
    onSuccess: (r) => {
      setRestoreTargetPath(null);
      setPendingActionId("backup");
      setOpsJobActive(true);
      setOpsFeedback(null);
      setActiveJobId(r.jobId);
      setActiveTab("backup");
    },
  });

  const restoreMutation = useMutation({
    mutationFn: (target: { path?: string; driveFolderId?: string }) =>
      apiFetch<{ jobId: string }>(`/sites/${params.id}/restore`, {
        method: "POST",
        body: JSON.stringify({
          backupPath: target.path || undefined,
          driveFolderId: target.path ? undefined : target.driveFolderId,
        }),
      }),
    onSuccess: (r, target) => {
      setRestoreTargetPath(target.path || target.driveFolderId || null);
      setPendingActionId("restore");
      setOpsJobActive(true);
      setOpsFeedback(null);
      setActiveJobId(r.jobId);
      setActiveTab("backup");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ jobId: string }>(`/sites/${params.id}/delete`, {
        method: "POST",
        body: JSON.stringify({ confirmDomain: deleteConfirmDomain }),
      }),
    onSuccess: (r) => {
      setDeleteModalOpen(false);
      setPendingActionId("delete");
      setOpsJobActive(true);
      setOpsFeedback(null);
      setActiveJobId(r.jobId);
      setActiveTab("danger");
    },
  });

  const updateDomainMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ jobId: string }>(`/sites/${params.id}/update-domain`, {
        method: "POST",
        body: JSON.stringify({ newDomain: newDomain.toLowerCase().trim() }),
      }),
    onSuccess: (r) => {
      setPendingActionId("update_domain");
      setOpsJobActive(true);
      setOpsFeedback(null);
      setActiveJobId(r.jobId);
      setActiveTab("domain");
    },
  });

  const wpAutologinMutation = useMutation({
    mutationFn: () => apiFetch<{ url: string }>(`/sites/${params.id}/wp-autologin`, { method: "POST" }),
    onSuccess: (r) => {
      setWpAutologinError(null);
      window.open(r.url, "_blank", "noopener,noreferrer");
    },
    onError: (err: Error) => setWpAutologinError(err.message),
  });

  const openWordPress = useCallback(() => {
    setWpAutologinError(null);
    wpAutologinMutation.mutate();
  }, [wpAutologinMutation]);

  const onJobComplete = useCallback(
    (status?: string) => {
      const completedJobId = activeJobId;
      const wasOpsJob = opsJobActive;
      setActiveJobId(null);
      setPendingActionId(null);
      setRestoreTargetPath(null);
      setOpsJobActive(false);
      void qc.invalidateQueries({ queryKey: ["site", params.id] });
      void qc.invalidateQueries({ queryKey: ["site-backups", params.id] });
      void qc.invalidateQueries({ queryKey: ["sites"] });
      void qc.invalidateQueries({ queryKey: ["server", site?.server.id] });
      void refetch();
      if (!completedJobId) return;
      void apiFetch<{
        operationKey: string;
        status: string;
        errorMessage?: string | null;
        resultJson?: {
          username?: string;
          password?: string;
          host?: string;
          newDomain?: string;
          actionLabel?: string;
          summary?: string;
          path?: string;
        };
      }>(`/jobs/${completedJobId}`).then((job) => {
        if (wasOpsJob && OPS_JOB_OPERATIONS.has(job.operationKey)) {
          if (job.status === "succeeded") {
            const title =
              job.resultJson?.actionLabel ??
              (job.operationKey === "site.backup"
                ? "Backup concluído"
                : job.operationKey === "site.restore"
                  ? "Backup restaurado"
                  : job.operationKey === "site.delete"
                  ? "Site excluído"
                  : "Operação concluída");
            const deleteResult = job.resultJson as { backup?: { backupPath?: string } } | undefined;
            const message =
              job.resultJson?.summary ??
              (job.operationKey === "site.delete" && deleteResult?.backup
                ? `Backup em ${deleteResult.backup.backupPath ?? "servidor"}`
                : job.resultJson?.path
                  ? `Arquivo: ${job.resultJson.path}`
                  : "Alteração aplicada no servidor.");
            setOpsFeedback({ status: "success", title, message });
          } else {
            setOpsFeedback({
              status: "error",
              title:
                job.operationKey === "site.delete"
                  ? "Exclusão falhou"
                  : (job.resultJson?.actionLabel ?? "Operação falhou"),
              message: job.errorMessage ?? "Não foi possível concluir a ação no servidor.",
            });
          }
        }

        if (job.operationKey === "site.ftp.user.create" || job.operationKey === "site.ftp.user.delete") {
          notifySiteFtpJobResult(job.operationKey, job.status, {
            username: job.resultJson?.username,
            password: job.resultJson?.password,
            host: job.resultJson?.host,
            errorMessage: job.errorMessage,
          });
        }
        if (job.operationKey === "site.delete" && job.status === "succeeded") {
          router.push("/sites");
          return;
        }
        if (job.operationKey === "site.delete" && job.status !== "succeeded") {
          setActiveTab("danger");
        }
        if (job.operationKey === "site.update.domain" && job.status === "succeeded" && job.resultJson?.newDomain) {
          router.push(`/sites/${params.id}`);
        }
      });
    },
    [activeJobId, opsJobActive, params.id, qc, refetch, router, site?.server.host, site?.server.id],
  );

  function runAction(action: UpdateAction) {
    const title = getManageActionTitle(action.id, action.label);
    if (action.destructive && !window.confirm(`Confirma "${title}" no site ${site?.domain}?`)) return;
    if (action.needsCloudflare) {
      setCfModal({ action: action.id, label: action.label });
      return;
    }
    manageMutation.mutate({ action: action.id });
  }

  function submitCfAction() {
    if (!cfModal) return;
    manageMutation.mutate({
      action: cfModal.action,
      cloudflareApiKey: cfKey,
      cloudflareEmail: cfEmail,
    });
  }

  const displayType = info?.siteType ?? site?.siteType;
  const displayPhp = info?.phpVersion ?? site?.phpVersion;
  const displayCache = info?.cacheBackend ?? site?.cacheBackend;
  const displayEnabled = info?.isEnabled ?? site?.isEnabled;
  const hasDatabase = Boolean(info?.dbName || info?.dbUser);
  const isWordPress = site ? isWordPressSite(site, info) : false;
  const actions = options?.updateActions ?? [];
  const actionsDisabled = Boolean(activeJobId);

  useEffect(() => {
    if (!site || autologinTried || searchParams.get("autologin") !== "1") return;
    if (!isWordPressSite(site, info)) return;
    setAutologinTried(true);
    openWordPress();
  }, [site, info, searchParams, autologinTried, openWordPress]);

  return (
    <AppShell title={site?.domain ?? "Site"}>
      {isLoading ? <p className="text-muted">Carregando...</p> : null}
      {isError ? (
        <p className="rounded-card bg-danger/10 px-3 py-2 text-sm text-danger">
          {(error as Error).message ?? "Erro ao carregar site"}
        </p>
      ) : null}

      {site ? (
        <div className="space-y-8">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={site.status} />
            <span className="text-sm text-muted">
              {site.server.name} ({site.server.host})
            </span>
            <Link href={`/servers/${site.server.id}`} className="btn-secondary btn-sm inline-flex items-center gap-1.5">
              <Server className="h-3.5 w-3.5" />
              Ver servidor
            </Link>
            <Link href={`/sites/migrate?siteId=${site.id}`} className="btn-accent-outline btn-sm inline-flex items-center gap-1.5">
              <Upload className="h-3.5 w-3.5" />
              Migrar via FTP
            </Link>
            <a
              href={`https://${site.domain}`}
              target="_blank"
              rel="noreferrer"
              className="btn-secondary btn-sm inline-flex items-center gap-1.5"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Abrir site
            </a>
            {isWordPress ? (
              <button
                type="button"
                onClick={openWordPress}
                disabled={wpAutologinMutation.isPending}
                className="btn-primary btn-sm inline-flex items-center gap-1.5"
              >
                <Globe className="h-3.5 w-3.5" />
                {wpAutologinMutation.isPending ? "Abrindo WordPress…" : "Acessar WordPress"}
              </button>
            ) : null}
            {site.lastObservedAt || activeJobId ? (
              <span className="text-xs text-muted">
                {activeJobId
                  ? "Sincronizando…"
                  : `Atualizado: ${formatObservedAt(site.lastObservedAt)}`}
              </span>
            ) : (
              <span className="text-xs text-muted">Sincronização automática ativa</span>
            )}
            <SiteDnsAlert siteId={site.id} serverIpHint={site.server.host} />
          </div>

          {activeJobId && !opsJobActive ? (
            <JobTracker jobId={activeJobId} onComplete={() => onJobComplete()} />
          ) : null}

          {opsFeedback ? (
            <SiteOpsResultBanner
              status={opsFeedback.status}
              title={opsFeedback.title}
              message={opsFeedback.message}
              onDismiss={() => setOpsFeedback(null)}
            />
          ) : null}

          {wpAutologinError ? (
            <p className="rounded-card bg-danger/10 px-3 py-2 text-sm text-danger">{wpAutologinError}</p>
          ) : null}

          <SiteDetailTabs
            active={activeTab}
            onChange={(tab) => {
              setActiveTab(tab);
              const next = new URLSearchParams(searchParams.toString());
              if (tab === "overview") next.delete("tab");
              else next.set("tab", tab);
              const qs = next.toString();
              router.replace(qs ? `/sites/${site.id}?${qs}` : `/sites/${site.id}`, { scroll: false });
            }}
          />

          {activeTab === "overview" ? (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Visão geral</h2>
              <span className="text-xs text-muted">
                {activeJobId
                  ? "Sincronizando…"
                  : `Dados: ${formatObservedAt(site.lastObservedAt)}`}
              </span>
            </div>

            <div className="glass-card p-4">
              <h3 className="mb-3 text-sm font-semibold text-ink">Recursos do site</h3>
              <SiteInventorySummary infoSnapshot={info} />
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="glass-card p-4">
                <p className="text-sm text-muted">Tipo / stack</p>
                <p className="font-medium">{displayType ?? "Não detectado"}</p>
                {info?.nginxConfig ? <p className="mt-1 text-xs text-muted">{info.nginxConfig}</p> : null}
              </div>
              <div className="glass-card p-4">
                <p className="text-sm text-muted">PHP</p>
                <p className="font-medium">{displayPhp ? `PHP ${displayPhp}` : "—"}</p>
              </div>
              <div className="glass-card p-4">
                <p className="text-sm text-muted">Cache</p>
                <p className="font-medium">{displayCache ?? "—"}</p>
              </div>
              <div className="glass-card p-4">
                <p className="text-sm text-muted">Status</p>
                <p className="font-medium">
                  {displayEnabled == null ? "—" : displayEnabled ? "Ativo" : "Desativado"}
                </p>
                {info?.isWordPress ? (
                  <span className="mt-1 inline-block rounded-full bg-accent/10 px-2 py-0.5 text-xs text-accent">
                    WordPress
                  </span>
                ) : null}
              </div>
            </div>
          </section>
          ) : null}

          {activeTab === "overview" ? (
          <section className="grid gap-4 lg:grid-cols-2">
            <div className="glass-card space-y-3 p-4">
              <h2 className="text-lg font-semibold">SSL</h2>
              <InfoRow
                label="Certificado"
                value={info?.sslEnabled == null ? "—" : info.sslEnabled ? "Ativo" : "Inativo"}
              />
              <InfoRow label="Provedor" value={info?.sslProvider} />
              <InfoRow
                label="Expira em"
                value={info?.sslExpiryDays != null ? `${info.sslExpiryDays} dias` : undefined}
              />
            </div>

            <div className="glass-card space-y-3 p-4">
              <h2 className="text-lg font-semibold">Caminhos</h2>
              <InfoRow label="Webroot" value={info?.webroot ?? `/var/www/${site.domain}`} mono />
              <InfoRow label="Access log" value={info?.accessLog} mono />
              <InfoRow label="Error log" value={info?.errorLog} mono />
            </div>
          </section>
          ) : null}

          {activeTab === "files" ? (
          <SiteFileManager siteId={site.id} domain={site.domain} webroot={info?.webroot} />
          ) : null}

          {activeTab === "database" ? (
          <section className="glass-card space-y-4 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Banco de dados</h2>
              <div className="flex flex-wrap gap-2">
                <a
                  href={dashboardUrl(site.server.host, "/db/pma/")}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-card border border-accent/30 px-3 py-1.5 text-xs text-accent hover:bg-accent/5"
                >
                  Abrir phpMyAdmin
                </a>
                <a
                  href={dashboardUrl(site.server.host, "/db/adminer/")}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-card border border-white/80 px-3 py-1.5 text-xs text-muted hover:bg-white"
                >
                  Adminer
                </a>
              </div>
            </div>

            {hasDatabase ? (
              <div className="space-y-3 rounded-card border border-white/70 bg-white/40 p-4">
                <InfoRow label="Host" value={info?.dbHost ?? "localhost"} mono />
                <InfoRow label="Banco" value={info?.dbName} mono />
                <InfoRow label="Usuário" value={info?.dbUser} mono />
                <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <span className="text-sm text-muted">Senha</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs break-all">
                      {showDbPass ? info?.dbPass ?? "—" : info?.dbPass ? "••••••••••••" : "—"}
                    </span>
                    {info?.dbPass ? (
                      <button
                        type="button"
                        onClick={() => setShowDbPass((v) => !v)}
                        className="rounded border px-2 py-0.5 text-xs text-muted hover:text-ink"
                      >
                        {showDbPass ? "Ocultar" : "Mostrar"}
                      </button>
                    ) : null}
                  </div>
                </div>
                <p className="text-xs text-muted">
                  Credenciais via <code className="text-[10px]">wo site info</code>. WordOps não armazena senha do admin WordPress.
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted">
                Nenhuma credencial de banco detectada. Aguarde a sincronização automática ou verifique se o site usa MariaDB.
              </p>
            )}
          </section>
          ) : null}

          {activeTab === "ops" ? (
          <>
          <section className="glass-card space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">Ajustes do site</h2>
                <p className="text-sm text-muted">Ligar/desligar, HTTPS, cache e versão do PHP.</p>
              </div>
              <span className="text-xs text-muted">
                {activeJobId && opsJobActive
                  ? "Atualizando após operação…"
                  : `Inventário: ${formatObservedAt(site.lastObservedAt)}`}
              </span>
            </div>
            <SiteInventorySummary infoSnapshot={info} compact />
          </section>

          {activeJobId && opsJobActive && pendingActionId !== "backup" && pendingActionId !== "restore" && pendingActionId !== "update_domain" ? (
            <OperationTerminal
              jobId={activeJobId}
              onComplete={(status) => onJobComplete(status)}
              onDismiss={() => {
                setActiveJobId(null);
                setPendingActionId(null);
                setRestoreTargetPath(null);
                setOpsJobActive(false);
              }}
            />
          ) : null}

          <section className="glass-card p-4">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold">O que você quer fazer?</h3>
              {activeJobId && opsJobActive && pendingActionId !== "backup" && pendingActionId !== "restore" && pendingActionId !== "update_domain" ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-accent">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Aplicando…
                </span>
              ) : null}
            </div>
            <SiteManagePanel
              actions={actions}
              infoSnapshot={info}
              disabled={actionsDisabled || manageMutation.isPending}
              pendingActionId={pendingActionId}
              activeJobId={activeJobId}
              onRun={runAction}
              error={manageMutation.error ? (manageMutation.error as Error).message : null}
            />
          </section>
          </>
          ) : null}

          {activeTab === "backup" ? (
          <>
          {activeJobId && opsJobActive && (pendingActionId === "backup" || pendingActionId === "restore") ? (
            <OperationTerminal
              jobId={activeJobId}
              onComplete={(status) => onJobComplete(status)}
              onDismiss={() => {
                setActiveJobId(null);
                setPendingActionId(null);
                setRestoreTargetPath(null);
                setOpsJobActive(false);
              }}
            />
          ) : null}

          <section className="glass-card p-5">
            <div className="mb-5">
              <h2 className="text-lg font-semibold">Backup</h2>
              <p className="text-sm text-muted">Crie e restaure cópias de segurança do site.</p>
            </div>
            <SiteBackupPanel
              siteId={params.id}
              domain={site.domain}
              disabled={actionsDisabled}
              backupPending={pendingActionId === "backup" && Boolean(activeJobId)}
              restorePending={pendingActionId === "restore" && Boolean(activeJobId)}
              restoreTargetPath={restoreTargetPath}
              onBackup={() => backupMutation.mutate()}
              onRestore={(target) => restoreMutation.mutate(target)}
            />
            {backupMutation.error ? (
              <p className="mt-4 text-sm text-danger">{(backupMutation.error as Error).message}</p>
            ) : null}
            {restoreMutation.error ? (
              <p className="mt-4 text-sm text-danger">{(restoreMutation.error as Error).message}</p>
            ) : null}
          </section>
          </>
          ) : null}

          {activeTab === "domain" ? (
          <>
          {activeJobId && opsJobActive && pendingActionId === "update_domain" ? (
            <OperationTerminal
              jobId={activeJobId}
              onComplete={(status) => onJobComplete(status)}
              onDismiss={() => {
                setActiveJobId(null);
                setPendingActionId(null);
                setOpsJobActive(false);
              }}
            />
          ) : null}

          <section className="glass-card p-5">
            <div className="mb-5">
              <h2 className="text-lg font-semibold">Domínio</h2>
              <p className="text-sm text-muted">Altere o endereço do site no servidor.</p>
            </div>
            <SiteDomainPanel
              domain={site.domain}
              disabled={actionsDisabled}
              pending={pendingActionId === "update_domain" && Boolean(activeJobId)}
              newDomain={newDomain}
              onNewDomainChange={setNewDomain}
              onSubmit={() => updateDomainMutation.mutate()}
              error={updateDomainMutation.error ? (updateDomainMutation.error as Error).message : null}
            />
          </section>
          </>
          ) : null}

          {activeTab === "danger" ? (
          <section className="space-y-3 rounded-shell border border-danger/30 bg-danger/5 p-5">
            {activeJobId && opsJobActive && pendingActionId === "delete" ? (
              <OperationTerminal
                jobId={activeJobId}
                onComplete={(status) => onJobComplete(status)}
              />
            ) : null}
            <h2 className="flex items-center gap-2 text-lg font-semibold text-danger">
              <Trash2 className="h-5 w-5" />
              Excluir site
            </h2>
            <p className="text-sm text-muted">
              Remove o site do servidor. Antes da exclusão, um backup completo (arquivos + banco) é criado
              automaticamente. Se o backup falhar, a exclusão é cancelada.
            </p>
            <button
              type="button"
              disabled={actionsDisabled}
              onClick={() => {
                setDeleteConfirmDomain("");
                setDeleteModalOpen(true);
              }}
              className="inline-flex items-center gap-2 rounded-card border border-danger/50 bg-danger/10 px-4 py-2 text-sm font-medium text-danger disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" />
              Excluir site do servidor
            </button>
            {deleteMutation.error ? (
              <p className="text-sm text-danger">{(deleteMutation.error as Error).message}</p>
            ) : null}
          </section>
          ) : null}

          {deleteModalOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="w-full max-w-md space-y-4 rounded-card bg-white p-6 shadow-lg">
                <h3 className="font-semibold text-danger">Confirmar exclusão</h3>
                <p className="text-sm text-muted">
                  Será criado um backup de recuperação e depois o site será removido do servidor. Digite{" "}
                  <strong>{site?.domain}</strong> para confirmar.
                </p>
                <input
                  className="w-full rounded-card border border-ink/20 px-3 py-2 text-sm focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
                  placeholder={site?.domain}
                  value={deleteConfirmDomain}
                  onChange={(e) => setDeleteConfirmDomain(e.target.value)}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="flex-1 rounded-card bg-danger px-3 py-2 text-sm text-white disabled:opacity-60"
                    disabled={
                      deleteConfirmDomain.toLowerCase() !== site?.domain.toLowerCase() || deleteMutation.isPending
                    }
                    onClick={() => deleteMutation.mutate()}
                  >
                    {deleteMutation.isPending ? "Iniciando…" : "Excluir com backup"}
                  </button>
                  <button
                    type="button"
                    className="rounded-card border px-3 py-2 text-sm"
                    onClick={() => setDeleteModalOpen(false)}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {cfModal ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="w-full max-w-md space-y-4 rounded-card bg-white p-6 shadow-lg">
                <h3 className="font-semibold">{cfModal.label}</h3>
                <p className="text-sm text-muted">Informe as credenciais Cloudflare para validação DNS.</p>
                <input
                  className="w-full rounded-card border border-ink/20 px-3 py-2 text-sm focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
                  type="password"
                  placeholder="Global API Key"
                  value={cfKey}
                  onChange={(e) => setCfKey(e.target.value)}
                />
                <input
                  className="w-full rounded-card border border-ink/20 px-3 py-2 text-sm focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
                  placeholder="E-mail Cloudflare"
                  value={cfEmail}
                  onChange={(e) => setCfEmail(e.target.value)}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="flex-1 rounded-card bg-accent px-3 py-2 text-sm text-white disabled:opacity-60"
                    disabled={!cfKey || !cfEmail || manageMutation.isPending}
                    onClick={submitCfAction}
                  >
                    Confirmar
                  </button>
                  <button type="button" className="rounded-card border px-3 py-2 text-sm" onClick={() => setCfModal(null)}>
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {activeTab === "cloudflare" ? (
            <section className="glass-card space-y-4 p-4">
              <SiteCloudflarePanel siteId={site.id} />
            </section>
          ) : null}

          {activeTab === "email" && site ? <SiteEmailPanel siteId={site.id} /> : null}

          {activeTab === "access" && site ? (
            <SiteFtpPanel
              siteId={site.id}
              domain={site.domain}
              serverId={site.server.id}
              serverHost={site.server.host}
              serverPort={site.server.port}
              ftpUsers={ftpUsers}
              stackComponents={site.server.stackComponents ?? []}
              actionsDisabled={actionsDisabled}
              onJobStarted={setActiveJobId}
              onRefresh={() => void refetch()}
            />
          ) : null}

          <Link href="/sites" className="btn-secondary">
            Voltar para sites
          </Link>
        </div>
      ) : null}
    </AppShell>
  );
}
