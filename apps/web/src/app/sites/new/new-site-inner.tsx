"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { JobTracker } from "@/components/job-tracker";
import { SiteCreationWizard } from "@/components/site-creation-wizard";
import { apiFetch } from "@/lib/api";
import { useState } from "react";

type CreateOptions = {
  siteTypes: { id: string; label: string; group: string; flag: string; desc: string }[];
  phpVersions: { id: string; label: string; flag: string | null }[];
  multisite: { id: string; label: string; flags: string[] }[];
  sslModes: { id: string; label: string; desc: string; flags: string[]; needsCloudflare: boolean }[];
  extraFlags: { id: string; label: string; flag: string; desc: string }[];
  docsUrl: string;
};

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

  const { data: options } = useQuery({
    queryKey: ["sites-create-options"],
    queryFn: () => apiFetch<CreateOptions>("/sites/create-options"),
  });

  return (
    <AppShell title="Criar site">
      {activeJobId ? (
        <div className="mx-auto max-w-2xl space-y-4">
          <div className="rounded-shell border border-accent/20 bg-accent/5 p-4 text-sm text-ink">
            <p className="font-medium">Estamos publicando seu site no servidor...</p>
            <p className="mt-1 text-muted">Aguarde a conclusão. Você será redirecionado automaticamente.</p>
          </div>
          <JobTracker
            jobId={activeJobId}
            onComplete={() => {
              void apiFetch<{ resultJson?: { siteId?: string } }>(`/jobs/${activeJobId}`).then((job) => {
                const siteId = job.resultJson?.siteId;
                if (siteId) router.push(`/sites/${siteId}`);
                else router.push("/sites");
              });
            }}
          />
        </div>
      ) : (
        <SiteCreationWizard
          presetServerId={presetServerId}
          servers={servers?.servers ?? []}
          options={options}
          onJobStarted={setActiveJobId}
        />
      )}
    </AppShell>
  );
}
