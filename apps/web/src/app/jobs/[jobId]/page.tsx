"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { apiFetch } from "@/lib/api";

type JobDetail = {
  id: string;
  operationKey: string;
  status: string;
  progress: number;
  currentStep?: string;
  errorMessage?: string;
  events: { sequence: number; type: string; message: string; progress?: number; createdAt: string }[];
};

const TERMINAL = new Set(["succeeded", "failed", "cancelled", "timed_out"]);

export default function JobDetailPage() {
  const params = useParams<{ jobId: string }>();

  const { data, isLoading } = useQuery({
    queryKey: ["job", params.jobId],
    queryFn: () => apiFetch<JobDetail>(`/jobs/${params.jobId}`),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status && TERMINAL.has(status)) return false;
      return 1500;
    },
  });

  return (
    <AppShell title="Detalhe do job">
      {isLoading ? <p className="text-muted">Carregando...</p> : null}
      {data ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={data.status} />
            <span className="text-sm text-muted">{data.operationKey}</span>
            <span className="text-sm">{data.progress}%</span>
          </div>
          {data.errorMessage ? <p className="text-sm text-danger">{data.errorMessage}</p> : null}
          <div className="rounded-card bg-dark p-4 font-mono text-sm text-white/90">
            <p className="mb-3 text-xs uppercase tracking-widest text-white/60">Timeline</p>
            <ol className="space-y-3">
              {data.events.map((event) => (
                <li key={event.sequence}>
                  <div className="flex items-start gap-3">
                    <span className="text-white/50">{String(event.sequence).padStart(2, "0")}</span>
                    <div>
                      <p>{event.message}</p>
                      {event.createdAt ? (
                        <p className="text-xs text-white/50">
                          {new Date(event.createdAt).toLocaleTimeString("pt-BR")}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <Link href="/jobs" className="text-sm text-muted hover:text-ink">
            Voltar para jobs
          </Link>
        </div>
      ) : null}
    </AppShell>
  );
}
