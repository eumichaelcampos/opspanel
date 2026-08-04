"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { apiFetch } from "@/lib/api";

type JobRow = {
  id: string;
  operationKey: string;
  status: string;
  progress: number;
  createdAt: string;
};

export default function JobsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["jobs"],
    queryFn: () => apiFetch<JobRow[]>("/jobs"),
  });

  return (
    <AppShell title="Jobs">
      {isLoading ? <p className="text-muted">Carregando...</p> : null}
      {!isLoading && data?.length === 0 ? <p className="text-muted">Nenhum job registrado ainda.</p> : null}
      <div className="space-y-3">
        {data?.map((job) => (
          <Link key={job.id} href={`/jobs/${job.id}`} className="glass-card block p-4 hover:bg-white">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium">{job.operationKey}</p>
                <p className="text-xs text-muted">{new Date(job.createdAt).toLocaleString("pt-BR")}</p>
              </div>
              <StatusBadge status={job.status} />
            </div>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}
