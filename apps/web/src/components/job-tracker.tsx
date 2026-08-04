"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { StatusBadge } from "@/components/status-badge";
import { apiFetch } from "@/lib/api";

type JobDetail = {
  id: string;
  status: string;
  progress: number;
  errorMessage?: string | null;
  events: { sequence: number; type: string; message: string; progress?: number }[];
};

const TERMINAL = new Set(["succeeded", "failed", "cancelled", "timed_out"]);

export function JobTracker({
  jobId,
  onComplete,
}: {
  jobId: string;
  onComplete?: (status: string) => void;
}) {
  const completedRef = useRef(false);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    completedRef.current = false;
  }, [jobId]);

  const { data } = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => apiFetch<JobDetail>(`/jobs/${jobId}`),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status && TERMINAL.has(status)) return false;
      return 1500;
    },
  });

  useEffect(() => {
    if (!data || !TERMINAL.has(data.status) || completedRef.current) return;
    completedRef.current = true;
    onCompleteRef.current?.(data.status);
  }, [data]);

  if (!data) {
    return <p className="text-sm text-muted">Acompanhando job...</p>;
  }

  return (
    <div className="space-y-3 rounded-card border border-white/70 bg-white/90 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={data.status} />
        <span className="text-sm text-muted">{data.progress}%</span>
      </div>
      {data.errorMessage ? <p className="text-sm text-danger">{data.errorMessage}</p> : null}
      <ol className="space-y-2 text-sm">
        {data.events.map((event) => (
          <li key={event.sequence} className="flex gap-2">
            <span className="text-muted">{String(event.sequence).padStart(2, "0")}</span>
            <span>{event.message}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
