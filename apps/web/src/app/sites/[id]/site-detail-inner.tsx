"use client";

import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { SiteFileManager } from "@/components/site-file-manager";
import { SiteDetailTabs, type SiteDetailTab } from "@/components/site-detail-tabs";
import { AppShell } from "@/components/app-shell";
import { JobTracker } from "@/components/job-tracker";
import { StatusBadge } from "@/components/status-badge";
import { apiFetch } from "@/lib/api";
import { formatObservedAt, SYNC_INTERVALS } from "@/lib/auto-sync";
import { useAutoSiteSync } from "@/lib/use-auto-site-sync";
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
  ftpUsers?: { id: string; username: string; homePath: string; createdAt: string }[];
};

type UpdateAction = {
  id: string;
  label: string;
  wo: string;
  needsCloudflare?: boolean;
  destructive?: boolean;
};

function dashboardUrl(host: string, path: string): string {
  return `https://${host}:22222${path}`;
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
  const qc = useQueryClient();
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [ftpUser, setFtpUser] = useState("");
  const [ftpPass, setFtpPass] = useState("");
  const [showDbPass, setShowDbPass] = useState(false);
  const [ftpResult, setFtpResult] = useState<{ username: string; password: string; host: string } | null>(null);
  const [cfModal, setCfModal] = useState<{ action: string; label: string } | null>(null);
  const [cfKey, setCfKey] = useState("");
  const [cfEmail, setCfEmail] = useState("");
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteConfirmDomain, setDeleteConfirmDomain] = useState("");
  const [domainModalOpen, setDomainModalOpen] = useState(false);
  const [newDomain, setNewDomain] = useState("");
  const [activeTab, setActiveTab] = useState<SiteDetailTab>("overview");

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
  const proftpd = site?.server.stackComponents?.find((c) => c.id === "proftpd");
  const proftpdReady = Boolean(proftpd?.installed && proftpd?.running);
  const proftpdUnknown = !site?.server.stackComponents?.length;

  useAutoSiteSync({
    siteId: params.id,
    enabled: Boolean(site),
    lastObservedAt: site?.lastObservedAt,
    activeJobId,
    onJobStarted: setActiveJobId,
  });

  const manageMutation = useMutation({
    mutationFn: (payload: { action: string; cloudflareApiKey?: string; cloudflareEmail?: string }) =>
      apiFetch<{ jobId: string }>(`/sites/${params.id}/manage`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: (r) => {
      setCfModal(null);
      setActiveJobId(r.jobId);
    },
  });

  const ftpMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ jobId: string }>(`/sites/${params.id}/ftp-users`, {
        method: "POST",
        body: JSON.stringify({
          username: ftpUser,
          password: ftpPass || undefined,
        }),
      }),
    onSuccess: (r) => setActiveJobId(r.jobId),
  });

  const proftpdMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ jobId: string }>(`/servers/${site!.server.id}/stack`, {
        method: "POST",
        body: JSON.stringify({ action: "install", components: ["proftpd"], force: true }),
      }),
    onSuccess: (r) => setActiveJobId(r.jobId),
  });

  const serverHealthMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ jobId: string }>(`/servers/${site!.server.id}/health`, { method: "POST" }),
    onSuccess: (r) => setActiveJobId(r.jobId),
  });

  const backupMutation = useMutation({
    mutationFn: () => apiFetch<{ jobId: string }>(`/sites/${params.id}/backup`, { method: "POST" }),
    onSuccess: (r) => setActiveJobId(r.jobId),
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ jobId: string }>(`/sites/${params.id}/delete`, {
        method: "POST",
        body: JSON.stringify({ confirmDomain: deleteConfirmDomain }),
      }),
    onSuccess: (r) => {
      setDeleteModalOpen(false);
      setActiveJobId(r.jobId);
    },
  });

  const updateDomainMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ jobId: string }>(`/sites/${params.id}/update-domain`, {
        method: "POST",
        body: JSON.stringify({ newDomain: newDomain.toLowerCase().trim() }),
      }),
    onSuccess: (r) => {
      setDomainModalOpen(false);
      setActiveJobId(r.jobId);
    },
  });

  const onJobComplete = useCallback(() => {
    const completedJobId = activeJobId;
    setActiveJobId(null);
    void qc.invalidateQueries({ queryKey: ["site", params.id] });
    void qc.invalidateQueries({ queryKey: ["sites"] });
    void qc.invalidateQueries({ queryKey: ["server", site?.server.id] });
    void refetch();
    if (!completedJobId) return;
    void apiFetch<{
      operationKey: string;
      status: string;
      resultJson?: { username?: string; password?: string; host?: string; newDomain?: string };
    }>(`/jobs/${completedJobId}`).then((job) => {
      if (job.operationKey === "site.ftp.user.create" && job.resultJson?.password) {
        setFtpResult({
          username: job.resultJson.username!,
          password: job.resultJson.password,
          host: job.resultJson.host ?? site?.server.host ?? "",
        });
        setFtpUser("");
        setFtpPass("");
      }
      if (job.operationKey === "site.delete" && job.status === "succeeded") {
        router.push("/sites");
      }
      if (job.operationKey === "site.update.domain" && job.status === "succeeded" && job.resultJson?.newDomain) {
        router.push(`/sites/${params.id}`);
      }
    });
  }, [activeJobId, params.id, qc, refetch, router, site?.server.host, site?.server.id]);

  function runAction(action: UpdateAction) {
    if (action.destructive && !window.confirm(`Confirma "${action.label}" no site ${site?.domain}?`)) return;
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
  const actions = options?.updateActions ?? [];
  const actionsDisabled = Boolean(activeJobId);

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
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={site.status} />
            <span className="text-muted">
              {site.server.name} ({site.server.host})
            </span>
            <Link href={`/servers/${site.server.id}`} className="text-sm text-accent hover:underline">
              Ver servidor
            </Link>
            {site.lastObservedAt || activeJobId ? (
              <span className="text-xs text-muted">
                {activeJobId
                  ? "Sincronizando…"
                  : `Atualizado: ${formatObservedAt(site.lastObservedAt)}`}
              </span>
            ) : (
              <span className="text-xs text-muted">Sincronização automática ativa</span>
            )}
          </div>

          {activeJobId ? <JobTracker jobId={activeJobId} onComplete={onJobComplete} /> : null}

          <SiteDetailTabs active={activeTab} onChange={setActiveTab} />

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
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Ações WordOps</h2>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {actions.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  disabled={actionsDisabled || manageMutation.isPending}
                  onClick={() => runAction(a)}
                  className={`rounded-card border px-4 py-3 text-left transition disabled:opacity-60 ${
                    a.destructive
                      ? "border-danger/40 bg-danger/5 hover:bg-danger/10"
                      : "border-white/80 bg-white/90 hover:bg-white"
                  }`}
                >
                  <p className="font-medium">{a.label}</p>
                  <p className="font-mono text-[10px] text-muted">{a.wo}</p>
                </button>
              ))}
            </div>
            {manageMutation.error ? (
              <p className="text-sm text-danger">{(manageMutation.error as Error).message}</p>
            ) : null}
          </section>

          <section className="space-y-4 rounded-shell border border-white/80 bg-white/90 p-5">
            <h2 className="text-lg font-semibold">Backup e manutenção</h2>
            {info?.lastBackup?.path ? (
              <div className="rounded-card border border-success/30 bg-success/5 px-4 py-3 text-sm">
                <p className="font-medium text-success">Último backup</p>
                <p className="mt-1 font-mono text-xs break-all">{info.lastBackup.path}</p>
                {info.lastBackup.createdAt ? (
                  <p className="mt-1 text-xs text-muted">
                    {new Date(info.lastBackup.createdAt).toLocaleString("pt-BR")}
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={actionsDisabled || backupMutation.isPending}
                onClick={() => backupMutation.mutate()}
                className="rounded-card border border-accent/40 bg-accent/10 px-4 py-2 text-sm font-medium text-accent disabled:opacity-60"
              >
                Criar backup agora
              </button>
              <button
                type="button"
                disabled={actionsDisabled}
                onClick={() => {
                  setNewDomain("");
                  setDomainModalOpen(true);
                }}
                className="rounded-card border border-white/80 bg-white px-4 py-2 text-sm hover:bg-white/80 disabled:opacity-60"
              >
                Trocar domínio
              </button>
            </div>
            <p className="text-xs text-muted">
              Backups ficam em <code className="text-[10px]">/var/backups/opspanel/</code> no servidor (arquivos + banco quando disponível).
            </p>
          </section>
          </>
          ) : null}

          {activeTab === "danger" ? (
          <section className="space-y-3 rounded-shell border border-danger/30 bg-danger/5 p-5">
            <h2 className="text-lg font-semibold text-danger">Excluir site</h2>
            <p className="text-sm text-muted">
              Remove o site do servidor WordOps. Antes da exclusão, um backup completo (pasta + banco de dados) é criado automaticamente. Se o backup falhar, a exclusão é cancelada.
            </p>
            <button
              type="button"
              disabled={actionsDisabled}
              onClick={() => {
                setDeleteConfirmDomain("");
                setDeleteModalOpen(true);
              }}
              className="rounded-card border border-danger/50 bg-danger/10 px-4 py-2 text-sm font-medium text-danger disabled:opacity-60"
            >
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
                  className="w-full rounded-card border px-3 py-2 text-sm"
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

          {domainModalOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="w-full max-w-md space-y-4 rounded-card bg-white p-6 shadow-lg">
                <h3 className="font-semibold">Trocar domínio</h3>
                <p className="text-sm text-muted">
                  Um backup será criado antes da troca. O domínio atual é <strong>{site?.domain}</strong>.
                </p>
                <input
                  className="w-full rounded-card border px-3 py-2 text-sm"
                  placeholder="novodominio.com.br"
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="flex-1 rounded-card bg-accent px-3 py-2 text-sm text-white disabled:opacity-60"
                    disabled={!newDomain.trim() || updateDomainMutation.isPending}
                    onClick={() => updateDomainMutation.mutate()}
                  >
                    {updateDomainMutation.isPending ? "Iniciando…" : "Confirmar troca"}
                  </button>
                  <button
                    type="button"
                    className="rounded-card border px-3 py-2 text-sm"
                    onClick={() => setDomainModalOpen(false)}
                  >
                    Cancelar
                  </button>
                </div>
                {updateDomainMutation.error ? (
                  <p className="text-sm text-danger">{(updateDomainMutation.error as Error).message}</p>
                ) : null}
              </div>
            </div>
          ) : null}

          {cfModal ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="w-full max-w-md space-y-4 rounded-card bg-white p-6 shadow-lg">
                <h3 className="font-semibold">{cfModal.label}</h3>
                <p className="text-sm text-muted">Informe as credenciais Cloudflare para validação DNS.</p>
                <input
                  className="w-full rounded-card border px-3 py-2 text-sm"
                  type="password"
                  placeholder="Global API Key"
                  value={cfKey}
                  onChange={(e) => setCfKey(e.target.value)}
                />
                <input
                  className="w-full rounded-card border px-3 py-2 text-sm"
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

          {activeTab === "access" ? (
          <section className="glass-card space-y-4 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Usuários FTP</h2>
              {proftpd ? (
                <span
                  className={`rounded-full px-2 py-1 text-xs ${
                    proftpdReady
                      ? "bg-success/15 text-success"
                      : proftpd.installed
                        ? "bg-warning/15 text-warning"
                        : "bg-white/80 text-muted"
                  }`}
                >
                  ProFTPd:{" "}
                  {!proftpd.installed
                    ? "não instalado"
                    : proftpd.running
                      ? "rodando"
                      : "instalado, parado"}
                </span>
              ) : null}
            </div>

            {proftpdUnknown ? (
              <div className="rounded-card border border-blue-200 bg-blue-50/80 px-4 py-3 text-sm text-blue-900">
                Status do ProFTPd no servidor desconhecido.{" "}
                <button
                  type="button"
                  disabled={actionsDisabled || serverHealthMutation.isPending}
                  onClick={() => serverHealthMutation.mutate()}
                  className="font-medium text-accent underline disabled:opacity-60"
                >
                  Detectar stack do servidor
                </button>
              </div>
            ) : null}

            {!proftpdReady && !proftpdUnknown ? (
              <div className="rounded-card border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-900">
                {!proftpd?.installed ? (
                  <>
                    ProFTPd não está instalado neste servidor. Ative para criar usuários FTP nos sites.
                  </>
                ) : (
                  <>ProFTPd instalado mas parado. Inicie o serviço ou reinstale.</>
                )}
                <div className="mt-3">
                  <button
                    type="button"
                    disabled={actionsDisabled || proftpdMutation.isPending}
                    onClick={() => proftpdMutation.mutate()}
                    className="rounded-card bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                  >
                    {proftpdMutation.isPending
                      ? "Instalando..."
                      : proftpd?.installed
                        ? "Reinstalar / iniciar ProFTPd"
                        : "Ativar ProFTPd no servidor"}
                  </button>
                </div>
              </div>
            ) : null}

            {ftpResult ? (
              <div className="rounded-card border border-success/30 bg-success/10 p-3 text-sm">
                <p className="font-medium">Credenciais FTP criadas</p>
                <p>Host: {ftpResult.host}</p>
                <p>Usuário: {ftpResult.username}</p>
                <p>Senha: {ftpResult.password}</p>
                <p className="mt-1 text-xs text-muted">Copie agora. A senha não será exibida novamente.</p>
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-3">
              <input
                className="rounded-card border bg-white/90 px-3 py-2 text-sm disabled:opacity-60"
                placeholder="Usuário FTP"
                value={ftpUser}
                disabled={!proftpdReady}
                onChange={(e) => setFtpUser(e.target.value)}
              />
              <input
                className="rounded-card border bg-white/90 px-3 py-2 text-sm disabled:opacity-60"
                placeholder="Senha (opcional, gera automaticamente)"
                type="password"
                value={ftpPass}
                disabled={!proftpdReady}
                onChange={(e) => setFtpPass(e.target.value)}
              />
              <button
                type="button"
                disabled={!proftpdReady || !ftpUser || actionsDisabled || ftpMutation.isPending}
                onClick={() => ftpMutation.mutate()}
                className="rounded-card bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                Adicionar usuário FTP
              </button>
            </div>

            {ftpUsers.length > 0 ? (
              <ul className="space-y-1 text-sm">
                {ftpUsers.map((u) => (
                  <li key={u.id} className="flex justify-between rounded-card bg-white/80 px-3 py-2">
                    <span>{u.username}</span>
                    <span className="font-mono text-xs text-muted">{u.homePath}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Nenhum usuário FTP cadastrado pelo painel.</p>
            )}
            {(ftpMutation.error || proftpdMutation.error || serverHealthMutation.error) && (
              <p className="text-sm text-danger">
                {((ftpMutation.error ?? proftpdMutation.error ?? serverHealthMutation.error) as Error).message}
              </p>
            )}
          </section>
          ) : null}

          <Link href="/sites" className="text-sm text-muted hover:text-ink">
            Voltar para sites
          </Link>
        </div>
      ) : null}
    </AppShell>
  );
}
