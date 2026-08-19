"use client";

import {
  DEFAULT_SITE_MIGRATE_DRAFT,
  SITE_MIGRATE_STEPS,
  buildSiteMigratePayload,
  siteMigrateProgress,
  siteMigrateMultisiteLabel,
  siteMigrateDbModeLabel,
  isMultisiteTarget,
  validateSiteMigrateStep,
  type SiteMigrateDraft,
  type SiteMigrateStepId,
  type SiteMigrateTarget,
} from "@opspanel/contracts";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronUp,
  Database,
  ExternalLink,
  Folder,
  FolderInput,
  Globe,
  Loader2,
  Plug,
  Rocket,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

type Props = {
  presetSiteId?: string;
  initialDraft?: SiteMigrateDraft;
  initialStepIndex?: number;
  targets: SiteMigrateTarget[];
  help?: {
    requirement?: string;
    mysqlMariaDb?: string;
    phpMyAdmin?: string;
    multisite?: string;
  };
  onDraftChange?: (draft: SiteMigrateDraft, stepIndex: number) => void;
  onJobStarted: (jobId: string) => void;
};

type SourceTestResult = {
  ok: true;
  cwd: string;
  entryCount: number;
  directories: string[];
  files: string[];
  hints: string[];
  note?: string;
};

type SourceBrowseResult = {
  path: string;
  entries: { name: string; path: string; isDirectory: boolean; size: number }[];
  note?: string;
};

function parentPath(path: string): string {
  const clean = path.replace(/\/+$/, "") || "/";
  if (clean === "/") return "/";
  const idx = clean.lastIndexOf("/");
  return idx <= 0 ? "/" : clean.slice(0, idx) || "/";
}

function stepIcon(id: SiteMigrateStepId) {
  switch (id) {
    case "site":
      return Globe;
    case "source":
      return FolderInput;
    case "database":
      return Database;
    case "review":
      return Rocket;
    default:
      return Globe;
  }
}

export function SiteMigrateWizard({
  presetSiteId,
  initialDraft,
  initialStepIndex = 0,
  targets,
  help,
  onDraftChange,
  onJobStarted,
}: Props) {
  const [draft, setDraft] = useState<SiteMigrateDraft>(() => ({
    ...DEFAULT_SITE_MIGRATE_DRAFT,
    ...initialDraft,
    siteId: initialDraft?.siteId || presetSiteId || "",
  }));
  const [stepIndex, setStepIndex] = useState(() =>
    Math.min(Math.max(initialStepIndex, 0), SITE_MIGRATE_STEPS.length - 1),
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [testResult, setTestResult] = useState<SourceTestResult | null>(null);
  const [browse, setBrowse] = useState<SourceBrowseResult | null>(null);
  const [sourceReady, setSourceReady] = useState(() => {
    const d = initialDraft;
    return Boolean(d?.sourceHost && d?.sourceUsername && d?.sourcePassword);
  });

  const selectedTarget = useMemo(
    () => targets.find((t) => t.id === draft.siteId) ?? null,
    [targets, draft.siteId],
  );

  const currentStep = SITE_MIGRATE_STEPS[stepIndex];
  const progress = currentStep ? siteMigrateProgress(currentStep.id) : 0;
  const isLastStep = stepIndex === SITE_MIGRATE_STEPS.length - 1;
  const isFirstStep = stepIndex === 0;

  function emitDraft(next: SiteMigrateDraft, nextStep = stepIndex) {
    onDraftChange?.(next, nextStep);
  }

  function patch(partial: Partial<SiteMigrateDraft>) {
    setDraft((prev) => {
      const next = { ...prev, ...partial };
      emitDraft(next);
      return next;
    });
    setError(null);
    if (
      partial.sourceProtocol !== undefined ||
      partial.sourceHost !== undefined ||
      partial.sourcePort !== undefined ||
      partial.sourceUsername !== undefined ||
      partial.sourcePassword !== undefined
    ) {
      setSourceReady(false);
      setTestResult(null);
      setBrowse(null);
    }
  }

  function sourceProbeBody(pathOverride?: string) {
    const port = draft.sourcePort.trim() ? Number.parseInt(draft.sourcePort, 10) : undefined;
    return {
      sourceProtocol: draft.sourceProtocol,
      sourceHost: draft.sourceHost.trim(),
      sourcePort: Number.isFinite(port) ? port : undefined,
      sourceUsername: draft.sourceUsername.trim(),
      sourcePassword: draft.sourcePassword,
      sourcePath: (pathOverride ?? draft.sourcePath).trim() || "/",
    };
  }

  async function testSource() {
    const validationError = validateSiteMigrateStep("source", draft, selectedTarget);
    if (validationError) {
      setError(validationError);
      return;
    }
    setTesting(true);
    setError(null);
    setTestResult(null);
    try {
      const result = await apiFetch<SourceTestResult>("/sites/migrate/source-test", {
        method: "POST",
        body: JSON.stringify(sourceProbeBody()),
      });
      setTestResult(result);
      setSourceReady(result.entryCount > 0);
      patch({ sourcePath: result.cwd });
      setBrowse({
        path: result.cwd,
        note: result.note,
        entries: [
          ...result.directories.map((name) => ({
            name,
            path: result.cwd === "/" ? `/${name}` : `${result.cwd.replace(/\/$/, "")}/${name}`,
            isDirectory: true,
            size: 0,
          })),
          ...result.files.map((name) => ({
            name,
            path: result.cwd === "/" ? `/${name}` : `${result.cwd.replace(/\/$/, "")}/${name}`,
            isDirectory: false,
            size: 0,
          })),
        ],
      });
      if (result.entryCount === 0) {
        setError("Pasta remota vazia. Em HostGator addon domain use / (a conta FTP já abre no site).");
      }
    } catch (err) {
      setSourceReady(false);
      setError(err instanceof Error ? err.message : "Falha ao testar conexão.");
    } finally {
      setTesting(false);
    }
  }

  async function browsePath(path: string) {
    const validationError = validateSiteMigrateStep("source", draft, selectedTarget);
    if (validationError) {
      setError(validationError);
      return;
    }
    setBrowsing(true);
    setError(null);
    try {
      const result = await apiFetch<SourceBrowseResult>("/sites/migrate/source-browse", {
        method: "POST",
        body: JSON.stringify(sourceProbeBody(path)),
      });
      setBrowse(result);
      patch({ sourcePath: result.path });
      setSourceReady(result.entries.length > 0);
      if (result.note) {
        setError(null);
      }
      if (result.entries.length === 0) {
        setError("Pasta vazia. Suba um nível ou use / na HostGator.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao listar pasta.");
    } finally {
      setBrowsing(false);
    }
  }

  function goNext() {
    if (!currentStep) return;
    const validationError = validateSiteMigrateStep(currentStep.id, draft, selectedTarget);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (currentStep.id === "source" && !sourceReady) {
      setError("Teste a conexão FTP e confirme a pasta remota antes de continuar.");
      return;
    }
    setError(null);
    if (isLastStep) {
      emitDraft(draft, stepIndex);
      void submit();
      return;
    }
    setStepIndex((i) => {
      const next = Math.min(i + 1, SITE_MIGRATE_STEPS.length - 1);
      emitDraft(draft, next);
      return next;
    });
  }

  function goBack() {
    setError(null);
    setStepIndex((i) => {
      const next = Math.max(i - 1, 0);
      emitDraft(draft, next);
      return next;
    });
  }

  async function handleSqlFile(file: File | null) {
    if (!file) {
      patch({ sqlFileName: "", sqlDumpBase64: "" });
      return;
    }
    if (!file.name.toLowerCase().endsWith(".sql") && !file.name.toLowerCase().endsWith(".gz")) {
      setError("Selecione um arquivo .sql ou .sql.gz");
      return;
    }
    if (file.size > 52_428_800) {
      setError("Arquivo SQL excede 50 MB");
      return;
    }
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    patch({ sqlFileName: file.name, sqlDumpBase64: btoa(binary) });
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const result = await apiFetch<{ jobId: string }>("/sites/migrate", {
        method: "POST",
        body: JSON.stringify(buildSiteMigratePayload(draft)),
      });
      onJobStarted(result.jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível iniciar a migração.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!currentStep) return null;

  const StepIcon = stepIcon(currentStep.id);

  return (
    <div className="wizard-enter mx-auto max-w-3xl space-y-6">
      <div className="rounded-shell border border-accent/20 bg-gradient-to-br from-accent/5 via-white/60 to-white/40 p-6 shadow-glass">
        <div className="flex items-start gap-3">
          <StepIcon className="mt-0.5 h-6 w-6 shrink-0 text-accent" />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              Passo {stepIndex + 1} de {SITE_MIGRATE_STEPS.length}
            </p>
            <h2 className="text-lg font-semibold text-ink">{currentStep.label}</h2>
            <p className="text-sm text-muted">{currentStep.description}</p>
          </div>
        </div>
        <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/80">
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent to-accent/70 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {help?.requirement ? (
        <p className="rounded-card border border-amber-200/80 bg-amber-50/90 px-4 py-3 text-sm text-amber-950">
          {help.requirement}{" "}
          <Link href="/sites/new" className="font-medium text-accent underline underline-offset-2">
            Criar site primeiro
          </Link>
        </p>
      ) : null}

      {help?.multisite && currentStep.id === "site" ? (
        <p className="rounded-card border border-blue-200/80 bg-blue-50/90 px-4 py-3 text-sm text-blue-950">
          {help.multisite}
        </p>
      ) : null}

      {error ? <p className="rounded-card bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p> : null}

      <div className="rounded-shell border border-white/80 bg-white/90 p-6 shadow-sm">
        {currentStep.id === "site" ? (
          <div className="space-y-4">
            {targets.length === 0 ? (
              <p className="text-sm text-muted">
                Nenhum site no inventário.{" "}
                <Link href="/sites/new" className="text-accent underline">
                  Crie um site
                </Link>{" "}
                no WordOps antes de migrar.
              </p>
            ) : (
              <>
                <label className="block space-y-2 text-sm">
                  <span className="font-medium text-ink">Site já criado no WordOps</span>
                  <select
                    className="w-full rounded-card border border-ink/20 bg-white px-3 py-2.5 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
                    value={draft.siteId}
                    onChange={(e) => patch({ siteId: e.target.value })}
                  >
                    <option value="">Selecione o site...</option>
                    {targets.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.domain}
                        {isMultisiteTarget(t.multisite) ? ` · ${siteMigrateMultisiteLabel(t.multisite)}` : ""} ·{" "}
                        {t.server.name}
                      </option>
                    ))}
                  </select>
                </label>

                {selectedTarget ? (
                  <div className="space-y-3 rounded-card border border-accent/20 bg-accent/5 p-4 text-sm">
                    <p className="font-medium text-ink">Destino detectado automaticamente</p>
                    <dl className="space-y-2">
                      <div className="flex justify-between gap-4">
                        <dt className="text-muted">Tipo</dt>
                        <dd className="text-ink">{siteMigrateMultisiteLabel(selectedTarget.multisite)}</dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-muted">Pasta (webroot)</dt>
                        <dd className="font-mono text-xs text-ink">{selectedTarget.webroot}</dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-muted">Servidor</dt>
                        <dd className="text-ink">{selectedTarget.server.host}</dd>
                      </div>
                      {selectedTarget.destDatabase ? (
                        <div className="flex justify-between gap-4">
                          <dt className="text-muted">MariaDB destino</dt>
                          <dd className="font-mono text-xs text-ink">
                            {selectedTarget.destDatabase.user}@{selectedTarget.destDatabase.host}/
                            {selectedTarget.destDatabase.name}
                          </dd>
                        </div>
                      ) : (
                        <p className="text-xs text-amber-800">
                          Banco MariaDB ainda não detectado. Sincronize o site ou crie com suporte a MySQL/WordPress.
                        </p>
                      )}
                      {selectedTarget.isWordPress && !isMultisiteTarget(selectedTarget.multisite) ? (
                        <p className="text-xs text-amber-900">
                          Destino é site único. Se a origem for Multisite em subpastas,{" "}
                          <Link href="/sites/new" className="underline">
                            crie outro site
                          </Link>{" "}
                          com Multisite → subpastas antes de migrar.
                        </p>
                      ) : null}
                      {isMultisiteTarget(selectedTarget.multisite) ? (
                        <p className="text-xs text-blue-900">
                          Destino Multisite pronto. Na etapa de banco, informe a URL antiga da rede para atualizar
                          DOMAIN_CURRENT_SITE e os sites filhos.
                        </p>
                      ) : null}
                    </dl>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <a
                        href={selectedTarget.phpMyAdminUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-card border border-accent/30 px-3 py-1.5 text-xs text-accent hover:bg-white"
                      >
                        phpMyAdmin WordOps
                        <ExternalLink className="h-3 w-3" />
                      </a>
                      <Link
                        href={`/sites/${selectedTarget.id}`}
                        className="inline-flex items-center gap-1 rounded-card border border-white/80 px-3 py-1.5 text-xs text-muted hover:bg-white"
                      >
                        Ver site
                      </Link>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : null}

        {currentStep.id === "source" ? (
          <div className="space-y-4">
            <label className="block space-y-2 text-sm">
              <span className="font-medium text-ink">Protocolo</span>
              <select
                className="w-full rounded-card border border-ink/20 bg-white px-3 py-2.5 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
                value={draft.sourceProtocol}
                onChange={(e) => patch({ sourceProtocol: e.target.value as SiteMigrateDraft["sourceProtocol"] })}
              >
                <option value="ftp">FTP</option>
                <option value="ftps">FTPS</option>
                <option value="sftp">SFTP</option>
              </select>
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-2 text-sm">
                <span className="font-medium text-ink">Host</span>
                <input
                  className="w-full rounded-card border border-ink/20 bg-white px-3 py-2.5 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
                  placeholder="ftp.seudominio.com"
                  value={draft.sourceHost}
                  onChange={(e) => patch({ sourceHost: e.target.value })}
                />
              </label>
              <label className="block space-y-2 text-sm">
                <span className="font-medium text-ink">Porta (opcional)</span>
                <input
                  className="w-full rounded-card border border-ink/20 bg-white px-3 py-2.5 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
                  placeholder={draft.sourceProtocol === "sftp" ? "22" : "21"}
                  value={draft.sourcePort}
                  onChange={(e) => patch({ sourcePort: e.target.value })}
                />
              </label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-2 text-sm">
                <span className="font-medium text-ink">Usuário</span>
                <input
                  className="w-full rounded-card border border-ink/20 bg-white px-3 py-2.5 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
                  value={draft.sourceUsername}
                  onChange={(e) => patch({ sourceUsername: e.target.value })}
                />
              </label>
              <label className="block space-y-2 text-sm">
                <span className="font-medium text-ink">Senha</span>
                <input
                  type="password"
                  className="w-full rounded-card border border-ink/20 bg-white px-3 py-2.5 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
                  value={draft.sourcePassword}
                  onChange={(e) => patch({ sourcePassword: e.target.value })}
                />
              </label>
            </div>
            <label className="block space-y-2 text-sm">
              <span className="font-medium text-ink">Pasta remota na hospedagem</span>
              <input
                className="w-full rounded-card border border-ink/20 bg-white px-3 py-2.5 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
                placeholder="/  (HostGator addon: use / )"
                value={draft.sourcePath}
                onChange={(e) => {
                  setSourceReady(false);
                  patch({ sourcePath: e.target.value });
                }}
              />
              <p className="text-xs text-muted">
                HostGator addon domain: a conta FTP já abre na pasta do site. Use <code>/</code>, não
                /home.../dominio. Teste a conexão e confira wp-config.php / wp-content na listagem.
              </p>
            </label>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void testSource()}
                disabled={testing || browsing}
                className="inline-flex items-center gap-2 rounded-card border border-accent/40 bg-accent/10 px-4 py-2 text-sm font-medium text-accent hover:bg-accent/15 disabled:opacity-60"
              >
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
                {testing ? "Testando…" : "Testar conexão"}
              </button>
              <button
                type="button"
                onClick={() => void browsePath(draft.sourcePath.trim() || "/")}
                disabled={testing || browsing}
                className="inline-flex items-center gap-2 rounded-card border border-white/80 bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-white/80 disabled:opacity-60"
              >
                {browsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Folder className="h-4 w-4" />}
                {browsing ? "Abrindo…" : "Abrir pastas"}
              </button>
            </div>

            {sourceReady && testResult ? (
              <div className="rounded-card border border-emerald-200 bg-emerald-50/90 px-4 py-3 text-sm text-emerald-950">
                <p className="inline-flex items-center gap-2 font-medium">
                  <CheckCircle2 className="h-4 w-4" />
                  Conexão OK · {testResult.entryCount} itens em {testResult.cwd}
                </p>
                {testResult.hints.length > 0 ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                    {testResult.hints.map((h) => (
                      <li key={h}>{h}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {browse ? (
              <div className="space-y-2 rounded-card border border-white/80 bg-white/70 p-3">
                {browse.note ? (
                  <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-950">
                    {browse.note}
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                  <span className="font-mono text-[11px] text-ink">{browse.path}</span>
                  <div className="flex gap-2">
                    {browse.path !== "/" ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded border px-2 py-1 hover:bg-white disabled:opacity-50"
                        disabled={browsing}
                        onClick={() => void browsePath(parentPath(browse.path))}
                      >
                        <ChevronUp className="h-3 w-3" />
                        Pasta acima
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="rounded border border-accent/30 px-2 py-1 text-accent hover:bg-accent/5 disabled:opacity-50"
                      disabled={browsing}
                      onClick={() => {
                        patch({ sourcePath: browse.path });
                        setSourceReady(true);
                      }}
                    >
                      Usar esta pasta
                    </button>
                  </div>
                </div>
                <ul className="max-h-56 overflow-y-auto divide-y divide-white/70 text-sm">
                  {browse.entries.length === 0 ? (
                    <li className="px-2 py-3 text-muted">Pasta vazia</li>
                  ) : (
                    browse.entries.map((entry) => (
                      <li key={entry.path}>
                        <button
                          type="button"
                          disabled={!entry.isDirectory || browsing}
                          onClick={() => {
                            if (entry.isDirectory) void browsePath(entry.path);
                          }}
                          className={cn(
                            "flex w-full items-center gap-2 px-2 py-2 text-left hover:bg-accent/5 disabled:cursor-default",
                            entry.isDirectory ? "text-ink" : "text-muted",
                          )}
                        >
                          {entry.isDirectory ? (
                            <Folder className="h-4 w-4 shrink-0 text-accent" />
                          ) : (
                            <span className="inline-block h-4 w-4 shrink-0 rounded-sm bg-black/10" />
                          )}
                          <span className="truncate">{entry.name}</span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        {currentStep.id === "database" ? (
          <div className="space-y-4">
            {help?.mysqlMariaDb ? (
              <p className="rounded-card border border-blue-200/80 bg-blue-50/90 px-4 py-3 text-sm text-blue-950">
                {help.mysqlMariaDb}
              </p>
            ) : null}

            <label className="block space-y-2 text-sm">
              <span className="font-medium text-ink">Como transferir o banco?</span>
              <select
                className="w-full rounded-card border border-ink/20 bg-white px-3 py-2.5 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
                value={draft.dbMode}
                onChange={(e) => patch({ dbMode: e.target.value as SiteMigrateDraft["dbMode"] })}
              >
                <option value="auto_wpconfig">Detectar do wp-config.php (recomendado)</option>
                <option value="hosting_mysql">Informar credenciais MySQL da hospedagem</option>
                <option value="phpmyadmin_export">Enviar arquivo .sql do phpMyAdmin</option>
                <option value="none">Sem banco (apenas arquivos)</option>
              </select>
            </label>

            {draft.dbMode === "auto_wpconfig" || draft.dbMode === "hosting_mysql" ? (
              <div className="rounded-card border border-amber-200/80 bg-amber-50/90 px-4 py-3 text-sm text-amber-950">
                <p className="font-medium">Se o Remote MySQL estiver bloqueado</p>
                <p className="mt-1 text-amber-900/90">
                  O OpsPanel tenta importar sozinho. Se a hospedagem bloquear o IP do servidor
                  {selectedTarget?.server.host ? (
                    <>
                      {" "}
                      (<span className="font-mono font-medium">{selectedTarget.server.host}</span>)
                    </>
                  ) : null}
                  , liberamos via FTP automaticamente. Se ainda falhar, use a opção de arquivo .sql.
                </p>
                <ol className="mt-2 list-decimal space-y-1 pl-4 text-amber-900/90">
                  <li>
                    cPanel → Remote MySQL → adicione{" "}
                    <span className="font-mono">{selectedTarget?.server.host || "IP do WordOps"}</span>
                  </li>
                  <li>Ou phpMyAdmin → Exportar SQL → escolha &quot;Enviar arquivo .sql&quot; aqui</li>
                </ol>
              </div>
            ) : null}

            {draft.dbMode === "hosting_mysql" ? (
              <div className="space-y-4">
                <p className="text-xs text-muted">
                  Use as mesmas credenciais do phpMyAdmin da hospedagem de origem (MySQL). O OpsPanel converte e
                  importa no MariaDB do WordOps.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block space-y-2 text-sm sm:col-span-2">
                    <span className="font-medium text-ink">Host MySQL (hospedagem)</span>
                    <input
                      className="w-full rounded-card border border-ink/20 bg-white px-3 py-2.5 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
                      placeholder="localhost ou mysql.seudominio.com"
                      value={draft.dbHost}
                      onChange={(e) => patch({ dbHost: e.target.value })}
                    />
                  </label>
                  <label className="block space-y-2 text-sm">
                    <span className="font-medium text-ink">Porta</span>
                    <input
                      className="w-full rounded-card border border-ink/20 bg-white px-3 py-2.5 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
                      value={draft.dbPort}
                      onChange={(e) => patch({ dbPort: e.target.value })}
                    />
                  </label>
                  <label className="block space-y-2 text-sm">
                    <span className="font-medium text-ink">Nome do banco</span>
                    <input
                      className="w-full rounded-card border border-ink/20 bg-white px-3 py-2.5 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
                      value={draft.dbName}
                      onChange={(e) => patch({ dbName: e.target.value })}
                    />
                  </label>
                  <label className="block space-y-2 text-sm">
                    <span className="font-medium text-ink">Usuário MySQL</span>
                    <input
                      className="w-full rounded-card border border-ink/20 bg-white px-3 py-2.5 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
                      value={draft.dbUser}
                      onChange={(e) => patch({ dbUser: e.target.value })}
                    />
                  </label>
                  <label className="block space-y-2 text-sm">
                    <span className="font-medium text-ink">Senha MySQL</span>
                    <input
                      type="password"
                      className="w-full rounded-card border border-ink/20 bg-white px-3 py-2.5 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
                      value={draft.dbPassword}
                      onChange={(e) => patch({ dbPassword: e.target.value })}
                    />
                  </label>
                </div>
              </div>
            ) : null}

            {draft.dbMode === "phpmyadmin_export" ? (
              <div className="space-y-3">
                <div className="rounded-card border border-white/70 bg-white/50 p-4 text-sm">
                  <p className="font-medium text-ink">Exportar na hospedagem de origem</p>
                  <ol className="mt-2 list-decimal space-y-1 pl-4 text-muted">
                    <li>Acesse o phpMyAdmin da hospedagem antiga</li>
                    <li>Selecione o banco do site e clique em Exportar</li>
                    <li>Formato SQL, método Rápido, e baixe o arquivo</li>
                    <li>Envie o .sql abaixo (conversão MySQL → MariaDB é automática)</li>
                  </ol>
                </div>
                <label className="block space-y-2 text-sm">
                  <span className="font-medium text-ink">Arquivo .sql</span>
                  <input
                    type="file"
                    accept=".sql,.gz,application/sql"
                    className="w-full text-sm focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
                    onChange={(e) => void handleSqlFile(e.target.files?.[0] ?? null)}
                  />
                  {draft.sqlFileName ? (
                    <p className="text-xs text-muted">Selecionado: {draft.sqlFileName}</p>
                  ) : null}
                </label>
              </div>
            ) : null}

            {selectedTarget ? (
              <div className="rounded-card border border-accent/20 bg-accent/5 p-4 text-sm">
                <p className="font-medium text-ink">Importação manual (alternativa)</p>
                <p className="mt-1 text-muted">
                  Você também pode importar direto no phpMyAdmin do WordOps após a migração dos arquivos.
                </p>
                <a
                  href={selectedTarget.phpMyAdminUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-1.5 rounded-card border border-accent/30 bg-white px-3 py-2 text-xs font-medium text-accent hover:bg-accent/5"
                >
                  Abrir phpMyAdmin do WordOps
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
                {selectedTarget.destDatabase ? (
                  <p className="mt-2 font-mono text-[11px] text-muted">
                    Banco destino: {selectedTarget.destDatabase.name} · usuário: {selectedTarget.destDatabase.user}
                  </p>
                ) : null}
              </div>
            ) : null}

            <label className="block space-y-2 text-sm">
              <span className="font-medium text-ink">
                URL antiga {isMultisiteTarget(selectedTarget?.multisite) ? "(obrigatória no Multisite)" : "(opcional)"}
              </span>
              <input
                className="w-full rounded-card border border-ink/20 bg-white px-3 py-2.5 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
                placeholder="https://site-antigo.com.br"
                value={draft.oldUrl}
                onChange={(e) => patch({ oldUrl: e.target.value })}
              />
              <p className="text-xs text-muted">
                {isMultisiteTarget(selectedTarget?.multisite)
                  ? "Substitui o domínio da rede em wp_blogs, wp_site e DOMAIN_CURRENT_SITE (ex.: https://meurede.com.br)."
                  : "Substitui links no WordPress após importar o banco."}
              </p>
            </label>
          </div>
        ) : null}

        {currentStep.id === "review" && selectedTarget ? (
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between gap-4 border-b border-white/80 pb-2">
              <dt className="text-muted">Site destino</dt>
              <dd className="font-medium text-ink">{selectedTarget.domain}</dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-white/80 pb-2">
              <dt className="text-muted">Tipo</dt>
              <dd className="font-medium text-ink">{siteMigrateMultisiteLabel(selectedTarget.multisite)}</dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-white/80 pb-2">
              <dt className="text-muted">Pasta destino</dt>
              <dd className="max-w-[60%] text-right font-mono text-xs text-ink">{selectedTarget.webroot}</dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-white/80 pb-2">
              <dt className="text-muted">Origem FTP</dt>
              <dd className="font-medium text-ink">
                {draft.sourceProtocol.toUpperCase()}://{draft.sourceHost}
                {draft.sourcePath}
              </dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-white/80 pb-2">
              <dt className="text-muted">Banco</dt>
              <dd className="font-medium text-ink">{siteMigrateDbModeLabel(draft.dbMode)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">MariaDB destino</dt>
              <dd className="font-medium text-ink">
                {selectedTarget.destDatabase?.name ?? "Manual via phpMyAdmin"}
              </dd>
            </div>
            <p className="pt-2 text-xs text-muted">
              Nada será instalado na origem. Arquivos vão para {selectedTarget.webroot}. MySQL da hospedagem é
              convertido para MariaDB automaticamente.
            </p>
          </dl>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={goBack}
          disabled={isFirstStep || submitting}
          className="inline-flex items-center gap-2 rounded-card border border-white/80 bg-white/90 px-4 py-2.5 text-sm font-medium text-ink transition hover:bg-white disabled:opacity-40"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </button>
        <button
          type="button"
          onClick={goNext}
          disabled={submitting || (currentStep.id === "site" && targets.length === 0)}
          className="inline-flex items-center gap-2 rounded-card bg-accent px-5 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Iniciando...
            </>
          ) : isLastStep ? (
            <>
              Migrar site
              <Rocket className="h-4 w-4" />
            </>
          ) : (
            <>
              Continuar
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
