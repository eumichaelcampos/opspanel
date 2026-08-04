"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Terminal, X } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";

type JobEvent = {
  sequence: number;
  type: string;
  message: string;
  progress?: number | null;
};

type JobDetail = {
  id: string;
  status: string;
  progress: number;
  currentStep?: string | null;
  operationKey?: string;
  errorMessage?: string | null;
  resultJson?: {
    outputFull?: string;
    outputPreview?: string;
    wordopsVersion?: string;
    verified?: boolean;
    dashboardCaptured?: boolean;
  } | null;
  events: JobEvent[];
};

const TERMINAL = new Set(["succeeded", "failed", "cancelled", "timed_out"]);

export function OperationTerminal({
  jobId,
  onComplete,
  onDismiss,
  defaultCollapsed = false,
}: {
  jobId: string;
  onComplete?: (status: string) => void;
  onDismiss?: () => void;
  defaultCollapsed?: boolean;
}) {
  const completedRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  const logEndRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    completedRef.current = false;
    setCollapsed(defaultCollapsed);
  }, [jobId, defaultCollapsed]);

  const { data } = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => apiFetch<JobDetail>(`/jobs/${jobId}`),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status && TERMINAL.has(status)) return false;
      return 1200;
    },
  });

  useEffect(() => {
    if (!data) return;
    if (data.status === "failed" || data.status === "timed_out" || data.status === "cancelled") {
      setCollapsed(false);
    }
  }, [data?.status, data?.id]);

  useEffect(() => {
    if (!data || !TERMINAL.has(data.status) || completedRef.current) return;
    completedRef.current = true;
    onCompleteRef.current?.(data.status);
  }, [data]);

  const lines = useMemo(() => {
    if (!data) return [];
    const logLines = (data.events ?? [])
      .filter((e) => e.type === "log" || e.type === "progress" || e.type === "error" || e.type === "done")
      .map((e) => {
        if (e.type === "log") return e.message;
        const prefix = e.type === "error" ? "[ERRO] " : e.type === "done" ? "[OK] " : "[…] ";
        return `${prefix}${e.message}`;
      });

    const outputFull = data.resultJson?.outputFull ?? data.resultJson?.outputPreview;
    const finished = TERMINAL.has(data.status);
    if (!outputFull) return logLines;

    const outputLines = outputFull.split("\n").filter(Boolean);
    if (!finished) {
      if (logLines.length < 5) return [...logLines, ...outputLines];
      return logLines;
    }

    if (logLines.length === 0) return outputLines;
    if (logLines.some((line) => line.startsWith("[ERRO]"))) {
      return [...logLines, "--- saída do servidor ---", ...outputLines];
    }
    if (outputLines.length > logLines.length) {
      return [...logLines, "--- saída do servidor ---", ...outputLines];
    }
    return logLines;
  }, [data]);

  useEffect(() => {
    if (!collapsed && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [lines.length, collapsed, data?.progress]);

  if (!data) {
    return (
      <div className="rounded-card border border-white/70 bg-black/90 px-4 py-3 font-mono text-xs text-green-400">
        Conectando ao terminal da operação…
      </div>
    );
  }

  const running = !TERMINAL.has(data.status);
  const failed = data.status === "failed" || data.status === "timed_out" || data.status === "cancelled";
  const queued = data.status === "queued";

  function emptyTerminalMessage(): string {
    if (queued) {
      return "Operação na fila… o worker processará em instantes. Se ficar parado por mais de 1 minuto, verifique se o worker está rodando (pnpm dev).";
    }
    if (failed && data.errorMessage) {
      return data.errorMessage;
    }
    if (running) {
      return data.currentStep
        ? `Executando: ${data.currentStep}…`
        : "Conectando ao servidor via SSH… a saída aparecerá em breve.";
    }
    return "Nenhuma saída registrada para esta operação.";
  }

  return (
    <div className="overflow-hidden rounded-card border border-white/70 bg-white/90 shadow-glass">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center gap-3 border-b border-white/60 px-4 py-3 text-left hover:bg-white/50"
        aria-expanded={!collapsed}
      >
        <Terminal className="h-4 w-4 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">Terminal da operação</p>
          <p className="truncate text-xs text-muted">
            {running ? "Executando… acompanhe a saída em tempo real" : failed ? "Operação finalizada com erro" : "Operação concluída com sucesso"}
            {data.resultJson?.wordopsVersion ? ` · WordOps v${data.resultJson.wordopsVersion}` : ""}
            {data.resultJson?.verified ? " · verificado" : ""}
          </p>
        </div>
        <StatusBadge status={data.status} />
        <span className="text-xs text-muted">{data.progress}%</span>
        {!running && onDismiss ? (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onDismiss();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                onDismiss();
              }
            }}
            className="rounded p-1 text-muted hover:bg-white hover:text-ink"
            aria-label="Fechar terminal"
          >
            <X className="h-4 w-4" />
          </span>
        ) : null}
        {collapsed ? <ChevronDown className="h-4 w-4 text-muted" /> : <ChevronUp className="h-4 w-4 text-muted" />}
      </button>

      {!collapsed ? (
        <div className="space-y-2 p-4">
          {data.errorMessage ? (
            <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              {data.errorMessage}
            </div>
          ) : null}
          {failed && !data.errorMessage && lines.length === 0 ? (
            <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              A operação falhou sem mensagem detalhada. Verifique conectividade SSH com o servidor.
            </div>
          ) : null}
          <div
            className={cn(
              "max-h-80 overflow-auto rounded-md border border-black/20 bg-[#0d1117] p-3 font-mono text-[11px] leading-relaxed text-green-400",
              running && "ring-1 ring-accent/30",
            )}
          >
            {lines.length === 0 ? (
              <p className={cn("whitespace-pre-wrap", failed ? "text-red-400" : "text-zinc-500")}>
                {emptyTerminalMessage()}
              </p>
            ) : (
              lines.map((line, i) => (
                <div key={`${i}-${line.slice(0, 24)}`} className="whitespace-pre-wrap break-all">
                  {line}
                </div>
              ))
            )}
            <div ref={logEndRef} />
          </div>
          {data.resultJson?.dashboardCaptured ? (
            <p className="text-xs text-success">Credenciais do dashboard WordOps capturadas e salvas no servidor.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
