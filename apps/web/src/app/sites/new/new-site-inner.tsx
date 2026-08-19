"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { OperationTerminal } from "@/components/operation-terminal";
import { SiteCreationWizard } from "@/components/site-creation-wizard";
import { apiFetch } from "@/lib/api";
import { useState } from "react";

export default function NewSitePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const presetServerId = searchParams.get("serverId") ?? "";
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const { data: servers } = useQuery({
    queryKey: ["servers"],
    queryFn: () =>
      apiFetch<{
        servers: { id: string; name: string; host: string; status: string; wordopsVersion?: string | null }[];
      }>("/servers"),
  });

  return (
    <AppShell title="Criar site">
      {activeJobId ? (
        <div className="mx-auto max-w-3xl space-y-4">
          <div className="rounded-shell border border-accent/20 bg-accent/5 p-4 text-sm text-ink">
            <p className="font-medium">Publicando site no WordOps…</p>
            <p className="mt-1 text-muted">
              Acompanhe o terminal abaixo. WordPress + SSL pode levar de 3 a 10 minutos. Não feche esta página.
            </p>
          </div>
          <OperationTerminal
            jobId={activeJobId}
            onComplete={(status) => {
              if (status !== "succeeded") return;
              void apiFetch<{ resultJson?: { siteId?: string } }>(`/jobs/${activeJobId}`).then((job) => {
                const siteId = job.resultJson?.siteId;
                if (siteId) router.push(`/sites/${siteId}?autologin=1`);
                else router.push("/sites");
              });
            }}
          />
        </div>
      ) : (
        <SiteCreationWizard
          presetServerId={presetServerId}
          servers={servers?.servers ?? []}
          onJobStarted={setActiveJobId}
        />
      )}
    </AppShell>
  );
}
