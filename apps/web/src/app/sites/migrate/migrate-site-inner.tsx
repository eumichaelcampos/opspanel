"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { OperationTerminal } from "@/components/operation-terminal";
import { SiteMigrateWizard } from "@/components/site-migrate-wizard";
import { SiteOpsResultBanner } from "@/components/site-ops-result-banner";
import { apiFetch } from "@/lib/api";
import {
  DEFAULT_SITE_MIGRATE_DRAFT,
  SITE_MIGRATE_STEPS,
  buildSiteMigratePayload,
  isSiteMigrateDbFailure,
  siteMigrateDbRecoverySteps,
  siteMigrateDraftLooksFilled,
  type SiteMigrateDraft,
  type SiteMigrateTarget,
} from "@opspanel/contracts";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type MigrateTargetsResponse = {
  sites: SiteMigrateTarget[];
  help?: {
    requirement?: string;
    mysqlMariaDb?: string;
    phpMyAdmin?: string;
    multisite?: string;
  };
};

const DRAFT_STORAGE_KEY = "opspanel.siteMigrate.draft";
const STEP_STORAGE_KEY = "opspanel.siteMigrate.stepIndex";

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function loadStoredDraft(presetSiteId: string): SiteMigrateDraft {
  const store = browserStorage();
  if (!store) return { ...DEFAULT_SITE_MIGRATE_DRAFT, siteId: presetSiteId };
  try {
    const raw = store.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SITE_MIGRATE_DRAFT, siteId: presetSiteId };
    const parsed = JSON.parse(raw) as SiteMigrateDraft;
    return {
      ...DEFAULT_SITE_MIGRATE_DRAFT,
      ...parsed,
      sqlDumpBase64: "",
      siteId: presetSiteId || parsed.siteId || "",
    };
  } catch {
    return { ...DEFAULT_SITE_MIGRATE_DRAFT, siteId: presetSiteId };
  }
}

function loadStoredStepIndex(): number {
  const store = browserStorage();
  if (!store) return 0;
  const raw = store.getItem(STEP_STORAGE_KEY);
  const n = raw ? Number.parseInt(raw, 10) : 0;
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, SITE_MIGRATE_STEPS.length - 1);
}

function persistDraft(draft: SiteMigrateDraft, stepIndex: number) {
  const store = browserStorage();
  if (!store) return;
  try {
    const { sqlDumpBase64: _sql, ...rest } = draft;
    store.setItem(DRAFT_STORAGE_KEY, JSON.stringify(rest));
    store.setItem(STEP_STORAGE_KEY, String(stepIndex));
  } catch {
    /* ignore quota */
  }
}

function mergeDraft(
  presetSiteId: string,
  stored: SiteMigrateDraft,
  targets: SiteMigrateTarget[],
): SiteMigrateDraft {
  const siteId = presetSiteId || stored.siteId;
  const target = targets.find((t) => t.id === siteId) ?? targets.find((t) => t.lastDraft?.sourceHost);
  const fromJob = target?.lastDraft;
  const base = siteMigrateDraftLooksFilled(stored)
    ? stored
    : {
        ...DEFAULT_SITE_MIGRATE_DRAFT,
        ...fromJob,
        ...stored,
        sourceHost: stored.sourceHost || fromJob?.sourceHost || "",
        sourceUsername: stored.sourceUsername || fromJob?.sourceUsername || "",
        sourcePassword: stored.sourcePassword || fromJob?.sourcePassword || "",
        sourcePath: stored.sourcePath || fromJob?.sourcePath || "/",
      };
  return {
    ...base,
    siteId: siteId || target?.id || base.siteId,
  };
}

export default function MigrateSitePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const presetSiteId = searchParams.get("siteId") ?? "";
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<"running" | "success" | "failed">("running");
  const [outcomeMessage, setOutcomeMessage] = useState<string | null>(null);
  const [outcomeErrorCode, setOutcomeErrorCode] = useState<string | null>(null);
  const [resultSiteId, setResultSiteId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SiteMigrateDraft>({
    ...DEFAULT_SITE_MIGRATE_DRAFT,
    siteId: presetSiteId,
  });
  const [wizardStepIndex, setWizardStepIndex] = useState(0);
  const [wizardKey, setWizardKey] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const hydratedRef = useRef(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["sites-migrate-targets"],
    queryFn: () => apiFetch<MigrateTargetsResponse>("/sites/migrate-targets"),
  });

  useEffect(() => {
    if (hydratedRef.current) return;
    if (isLoading) return;
    const stored = loadStoredDraft(presetSiteId);
    const next = mergeDraft(presetSiteId, stored, data?.sites ?? []);
    const storedStep = loadStoredStepIndex();
    const stepIndex =
      siteMigrateDraftLooksFilled(next) && storedStep === 0 ? SITE_MIGRATE_STEPS.length - 1 : storedStep;
    setDraft(next);
    setWizardStepIndex(stepIndex);
    persistDraft(next, stepIndex);
    hydratedRef.current = true;
    setDraftReady(true);
  }, [presetSiteId, isLoading, data]);

  function handleDraftChange(next: SiteMigrateDraft, stepIndex: number) {
    setDraft(next);
    setWizardStepIndex(stepIndex);
    persistDraft(next, stepIndex);
  }

  function handleJobComplete(status: string) {
    if (status !== "succeeded") {
      setOutcome("failed");
      void apiFetch<{ errorMessage?: string | null; errorCode?: string | null }>(`/jobs/${activeJobId}`).then(
        (job) => {
          setOutcomeErrorCode(job.errorCode ?? null);
          setOutcomeMessage(
            job.errorMessage ?? "A migração falhou. Ajuste os dados da origem e tente novamente.",
          );
        },
      );
      return;
    }
    setOutcome("success");
    setOutcomeErrorCode(null);
    try {
      sessionStorage.removeItem(DRAFT_STORAGE_KEY);
      sessionStorage.removeItem(STEP_STORAGE_KEY);
      localStorage.removeItem(DRAFT_STORAGE_KEY);
      localStorage.removeItem(STEP_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    void apiFetch<{ resultJson?: { siteId?: string; domain?: string; webroot?: string } }>(
      `/jobs/${activeJobId}`,
    ).then((job) => {
      const siteId = job.resultJson?.siteId ?? null;
      setResultSiteId(siteId);
      const domain = job.resultJson?.domain;
      const webroot = job.resultJson?.webroot;
      setOutcomeMessage(
        domain
          ? `Site ${domain} migrado com sucesso${webroot ? ` para ${webroot}` : ""}.`
          : "Migração concluída com sucesso.",
      );
    });
  }

  function backToWizard(stepIndex = wizardStepIndex) {
    setActiveJobId(null);
    setOutcome("running");
    setOutcomeMessage(null);
    setOutcomeErrorCode(null);
    setResultSiteId(null);
    setWizardStepIndex(stepIndex);
    persistDraft(draft, stepIndex);
    setWizardKey((k) => k + 1);
  }

  function recoverWithSqlUpload() {
    const next = { ...draft, dbMode: "phpmyadmin_export" as const };
    setDraft(next);
    const databaseStep = SITE_MIGRATE_STEPS.findIndex((s) => s.id === "database");
    backToWizard(databaseStep >= 0 ? databaseStep : 2);
    persistDraft(next, databaseStep >= 0 ? databaseStep : 2);
  }

  const selectedTarget = useMemo(
    () => data?.sites.find((s) => s.id === draft.siteId) ?? null,
    [data?.sites, draft.siteId],
  );
  const showDbRecovery = outcome === "failed" && isSiteMigrateDbFailure(outcomeMessage, outcomeErrorCode);
  const dbRecoverySteps = siteMigrateDbRecoverySteps(selectedTarget?.server.host);

  async function retryMigration() {
    setRetrying(true);
    setOutcomeMessage(null);
    setOutcomeErrorCode(null);
    try {
      const result = await apiFetch<{ jobId: string }>("/sites/migrate", {
        method: "POST",
        body: JSON.stringify(buildSiteMigratePayload(draft)),
      });
      setOutcome("running");
      setResultSiteId(null);
      setActiveJobId(result.jobId);
    } catch (err) {
      setOutcome("failed");
      setOutcomeMessage(err instanceof Error ? err.message : "Não foi possível reiniciar a migração.");
    } finally {
      setRetrying(false);
    }
  }

  return (
    <AppShell title="Migrar site">
      {activeJobId ? (
        <div className="mx-auto max-w-3xl space-y-4">
          {outcome === "success" && outcomeMessage ? (
            <SiteOpsResultBanner
              status="success"
              title="Migração concluída"
              message={outcomeMessage}
              onDismiss={() => backToWizard(0)}
            />
          ) : null}

          {outcome === "failed" && outcomeMessage ? (
            <SiteOpsResultBanner
              status="error"
              title="Migração falhou"
              message={outcomeMessage}
              onDismiss={() => backToWizard(SITE_MIGRATE_STEPS.length - 1)}
            />
          ) : null}

          {showDbRecovery ? (
            <div className="rounded-card border border-amber-200/80 bg-amber-50/90 px-4 py-4 text-sm text-amber-950">
              <p className="font-medium">Como corrigir o banco (passo a passo)</p>
              <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-amber-900/95">
                {dbRecoverySteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-card bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
                  onClick={() => recoverWithSqlUpload()}
                >
                  Usar arquivo .sql do phpMyAdmin
                </button>
                <button
                  type="button"
                  className="rounded-card border border-amber-300 bg-white/80 px-3 py-1.5 text-xs font-medium text-amber-950 hover:bg-white"
                  onClick={() => backToWizard(SITE_MIGRATE_STEPS.findIndex((s) => s.id === "database"))}
                >
                  Ajustar opções de banco
                </button>
              </div>
            </div>
          ) : null}

          {outcome === "running" ? (
            <div className="rounded-shell border border-accent/20 bg-accent/5 p-4 text-sm text-ink">
              <p className="font-medium">Migração em andamento...</p>
              <p className="mt-1 text-muted">
                Baixando arquivos da hospedagem e publicando no site WordOps. Isso pode levar vários minutos.
              </p>
            </div>
          ) : null}

          <OperationTerminal jobId={activeJobId} onComplete={handleJobComplete} />

          {outcome === "success" ? (
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className="rounded-card bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
                onClick={() => {
                  if (resultSiteId) router.push(`/sites/${resultSiteId}`);
                  else router.push("/sites");
                }}
              >
                Abrir site migrado
              </button>
              <button
                type="button"
                className="rounded-card border px-4 py-2 text-sm text-muted hover:bg-white"
                onClick={() => backToWizard(0)}
              >
                Nova migração
              </button>
            </div>
          ) : null}

          {outcome === "failed" ? (
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={retrying}
                className="inline-flex items-center gap-2 rounded-card bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
                onClick={() => void retryMigration()}
              >
                {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {retrying ? "Reiniciando…" : "Tentar novamente"}
              </button>
              <button
                type="button"
                className="rounded-card border px-4 py-2 text-sm text-ink hover:bg-white"
                onClick={() => backToWizard(SITE_MIGRATE_STEPS.length - 1)}
              >
                Corrigir dados
              </button>
              <Link
                href={`/jobs/${activeJobId}`}
                className="rounded-card border px-4 py-2 text-sm text-muted hover:bg-white"
              >
                Ver detalhe do job
              </Link>
            </div>
          ) : null}
        </div>
      ) : isLoading || !draftReady ? (
        <p className="text-muted">Carregando sites disponíveis...</p>
      ) : error ? (
        <p className="text-danger">{(error as Error).message}</p>
      ) : (
        <SiteMigrateWizard
          key={wizardKey}
          presetSiteId={presetSiteId}
          initialDraft={draft}
          initialStepIndex={wizardStepIndex}
          targets={data?.sites ?? []}
          help={data?.help}
          onDraftChange={handleDraftChange}
          onJobStarted={(jobId) => {
            setOutcome("running");
            setOutcomeMessage(null);
            setResultSiteId(null);
            setActiveJobId(jobId);
          }}
        />
      )}
    </AppShell>
  );
}
