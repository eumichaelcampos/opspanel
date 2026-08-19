"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { formatObservedAt } from "@/lib/auto-sync";
import { cn } from "@/lib/utils";

export type SiteDnsCheckResult = {
  status: "ok" | "cloudflare" | "mismatch" | "no_records" | "unknown";
  domain: string;
  serverHost: string;
  serverIps: string[];
  resolvedIps: string[];
  proxyProvider?: "cloudflare" | null;
  checkedAt: string;
  message: string;
};

type SiteDnsAlertProps = {
  siteId: string;
  serverIpHint?: string;
};

function dnsSeenStorageKey(siteId: string) {
  return `opspanel:site-dns-warn-seen:${siteId}`;
}

export function SiteDnsAlert({ siteId, serverIpHint }: SiteDnsAlertProps) {
  const [expanded, setExpanded] = useState(false);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["site-dns", siteId],
    queryFn: () => apiFetch<SiteDnsCheckResult>(`/sites/${siteId}/dns`),
    refetchInterval: 60_000,
  });

  const isHealthy = data?.status === "ok" || data?.status === "cloudflare";
  const isCloudflare = data?.status === "cloudflare";
  const hasProblem = Boolean(data && !isHealthy);

  useEffect(() => {
    if (!hasProblem || typeof window === "undefined") return;
    const seen = sessionStorage.getItem(dnsSeenStorageKey(siteId));
    if (!seen) {
      setExpanded(true);
      sessionStorage.setItem(dnsSeenStorageKey(siteId), "1");
    }
  }, [hasProblem, siteId]);

  const targetIp = data?.serverIps[0] ?? serverIpHint ?? data?.serverHost;

  if (isLoading) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted">
        <span className="h-2 w-2 animate-pulse rounded-full bg-white/50" aria-hidden />
        DNS…
      </span>
    );
  }

  if (isError || !data) {
    return (
      <>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-full px-1 py-0.5 text-xs text-warning hover:bg-warning/10"
          aria-expanded={expanded}
        >
          <span className="h-2 w-2 rounded-full bg-danger" aria-hidden />
          DNS
        </button>
        {expanded ? (
          <div className="w-full basis-full">
            <div className="rounded-card border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-ink">
              <p className="font-medium text-warning">DNS não verificado</p>
              <p className="mt-1 text-muted">Não foi possível consultar o apontamento do domínio agora.</p>
              <button
                type="button"
                onClick={() => void refetch()}
                className="mt-2 text-sm text-accent hover:underline"
              >
                Tentar novamente
              </button>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  if (isHealthy) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-xs text-muted"
        title={
          isCloudflare
            ? "DNS via Cloudflare (proxy ativo)"
            : `DNS apontando para ${targetIp ?? "o servidor"}`
        }
      >
        <span className="h-2 w-2 rounded-full bg-success" aria-hidden />
        <span>DNS</span>
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-1 py-0.5 text-xs transition",
          expanded ? "bg-warning/15 text-warning" : "text-warning hover:bg-warning/10",
        )}
        aria-expanded={expanded}
        title="DNS com problema. Clique para ver o que fazer."
      >
        <span className="h-2 w-2 rounded-full bg-danger" aria-hidden />
        DNS
      </button>

      {expanded ? (
        <div className="w-full basis-full">
          <div className="rounded-card border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-2">
                <p className="font-medium text-warning">
                  {data.status === "no_records" ? "Domínio sem registro DNS" : "DNS ainda não aponta para o servidor"}
                </p>
                <p className="text-ink">{data.message}</p>
                <div className="rounded-lg border border-warning/20 bg-white/50 px-3 py-2 text-xs text-ink">
                  <p className="font-medium">O que fazer no painel do domínio</p>
                  <ul className="mt-1 list-inside list-disc space-y-1 text-muted">
                    <li>
                      Crie ou ajuste um registro <strong className="text-ink">A</strong> para{" "}
                      <span className="font-mono">{data.domain}</span>
                    </li>
                    <li>
                      Aponte para o IP do servidor: <span className="font-mono text-ink">{targetIp}</span>
                    </li>
                    <li>Remova registros A antigos que apontem para outro host</li>
                    <li>A propagação pode levar de alguns minutos até 48 horas</li>
                  </ul>
                </div>
                {data.resolvedIps.length ? (
                  <p className="font-mono text-xs text-muted">DNS atual: {data.resolvedIps.join(", ")}</p>
                ) : null}
              </div>
              <div className="flex flex-col items-end gap-2">
                <Link
                  href={`/sites/${siteId}?tab=cloudflare`}
                  className="text-xs text-accent hover:underline"
                >
                  Gerenciar no Cloudflare
                </Link>
                <button
                  type="button"
                  onClick={() => void refetch()}
                  disabled={isFetching}
                  className="text-xs text-accent hover:underline disabled:opacity-60"
                >
                  {isFetching ? "Verificando…" : "Verificar novamente"}
                </button>
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  className="text-xs text-muted hover:text-ink"
                >
                  Ocultar
                </button>
              </div>
            </div>
            <p className="mt-2 text-xs text-muted">Verificado: {formatObservedAt(data.checkedAt)}</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
