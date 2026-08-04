"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpCircle, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";

type UpdateStatus = {
  currentVersion: string;
  latestVersion: string | null;
  changelog: string | null;
  releaseUrl: string | null;
  updateAvailable: boolean;
  dismissed: boolean;
  lastCheckedAt: string | null;
  applyStatus: "idle" | "running" | "success" | "failed";
  applyLog: string | null;
  applyStartedAt: string | null;
  applyFinishedAt: string | null;
  canApply: boolean;
};

function ChangelogBlock({ text }: { text: string }) {
  return (
    <div className="max-h-64 overflow-y-auto rounded-xl border border-white/80 bg-white/60 p-4 text-sm leading-relaxed text-ink whitespace-pre-wrap">
      {text.trim() || "Sem notas de versão."}
    </div>
  );
}

export function UpdateNotification() {
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);

  const { data, refetch } = useQuery({
    queryKey: ["updates", "status"],
    queryFn: () => apiFetch<{ update: UpdateStatus }>("/updates/status"),
    refetchInterval: (query) => {
      const status = query.state.data?.update.applyStatus;
      return status === "running" ? 3000 : 120_000;
    },
  });

  const update = data?.update;
  const showBanner = Boolean(update?.updateAvailable && !update.dismissed);

  useEffect(() => {
    if (update?.applyStatus === "success") {
      setModalOpen(true);
    }
  }, [update?.applyStatus]);

  const dismissMutation = useMutation({
    mutationFn: (version: string) =>
      apiFetch("/updates/dismiss", {
        method: "POST",
        body: JSON.stringify({ version }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["updates", "status"] }),
  });

  const applyMutation = useMutation({
    mutationFn: () => apiFetch<{ ok: boolean; message: string; update: UpdateStatus }>("/updates/apply", { method: "POST" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["updates", "status"] });
      void refetch();
    },
  });

  const checkMutation = useMutation({
    mutationFn: () => apiFetch("/updates/check", { method: "POST" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["updates", "status"] }),
  });

  if (!update) return null;

  return (
    <>
      {showBanner ? (
        <div className="glass-panel flex flex-wrap items-center justify-between gap-3 border border-accent/25 bg-accent/8 px-4 py-3">
          <div className="flex min-w-0 items-start gap-3">
            <ArrowUpCircle className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">
                Nova versão disponível: v{update.latestVersion}
              </p>
              <p className="text-xs text-muted">
                Você está na v{update.currentVersion}.
                {update.canApply
                  ? " Clique em atualizar para aplicar as mudanças."
                  : " Peça a um administrador para aplicar a atualização."}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-xl border border-white/80 bg-white/70 px-3 py-2 text-xs font-medium text-ink transition hover:bg-white"
              onClick={() => setModalOpen(true)}
            >
              Ver mudanças
            </button>
            {update.canApply ? (
              <button
                type="button"
                disabled={applyMutation.isPending || update.applyStatus === "running"}
                className="rounded-xl bg-accent px-3 py-2 text-xs font-medium text-white transition hover:opacity-95 disabled:opacity-60"
                onClick={() => {
                  setModalOpen(true);
                  if (update.applyStatus !== "running") applyMutation.mutate();
                }}
              >
                {applyMutation.isPending || update.applyStatus === "running" ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Atualizando…
                  </span>
                ) : (
                  "Atualizar agora"
                )}
              </button>
            ) : null}
            <button
              type="button"
              aria-label="Dispensar notificação"
              className="rounded-lg p-1.5 text-muted transition hover:bg-white/70 hover:text-ink"
              onClick={() => {
                if (update.latestVersion) dismissMutation.mutate(update.latestVersion);
              }}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}

      {modalOpen ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col gap-4 overflow-hidden rounded-card bg-white p-6 shadow-lg">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-ink">
                  {update.applyStatus === "success"
                    ? "Atualização concluída"
                    : `Atualização v${update.latestVersion ?? update.currentVersion}`}
                </h3>
                <p className="text-sm text-muted">
                  Versão atual: v{update.currentVersion}
                  {update.latestVersion ? ` · Nova: v${update.latestVersion}` : null}
                </p>
              </div>
              <button
                type="button"
                className="rounded-lg p-1 text-muted hover:bg-black/5"
                onClick={() => setModalOpen(false)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {update.changelog ? <ChangelogBlock text={update.changelog} /> : null}

            {update.applyStatus === "running" || update.applyLog ? (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Progresso</p>
                <pre
                  className={cn(
                    "max-h-40 overflow-y-auto rounded-xl border bg-black/5 p-3 text-xs leading-relaxed text-ink",
                    update.applyStatus === "running" && "animate-pulse",
                  )}
                >
                  {update.applyLog ?? "Aguardando log…"}
                </pre>
              </div>
            ) : null}

            {applyMutation.error ? (
              <p className="text-sm text-danger">{(applyMutation.error as Error).message}</p>
            ) : null}

            {update.applyStatus === "success" ? (
              <p className="text-sm text-accent">
                Atualização aplicada. Reinicie os serviços se necessário e recarregue a página.
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2 pt-1">
              {update.canApply && update.updateAvailable && update.applyStatus !== "success" ? (
                <button
                  type="button"
                  disabled={applyMutation.isPending || update.applyStatus === "running"}
                  className="flex-1 rounded-card bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                  onClick={() => applyMutation.mutate()}
                >
                  {applyMutation.isPending || update.applyStatus === "running" ? "Atualizando…" : "Atualizar agora"}
                </button>
              ) : null}
              {update.applyStatus === "success" ? (
                <button
                  type="button"
                  className="flex-1 rounded-card bg-accent px-3 py-2 text-sm font-medium text-white"
                  onClick={() => window.location.reload()}
                >
                  Recarregar página
                </button>
              ) : null}
              {update.canApply ? (
                <button
                  type="button"
                  className="rounded-card border px-3 py-2 text-sm"
                  disabled={checkMutation.isPending}
                  onClick={() => checkMutation.mutate()}
                >
                  {checkMutation.isPending ? "Verificando…" : "Verificar de novo"}
                </button>
              ) : null}
              {update.releaseUrl ? (
                <a
                  href={update.releaseUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-card border px-3 py-2 text-sm"
                >
                  Release no GitHub
                </a>
              ) : null}
              <button
                type="button"
                className="rounded-card border px-3 py-2 text-sm"
                onClick={() => setModalOpen(false)}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
