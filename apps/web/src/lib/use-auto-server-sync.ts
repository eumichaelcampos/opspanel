"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { isObservedStale, SYNC_INTERVALS } from "@/lib/auto-sync";

type Options = {
  serverId: string;
  enabled: boolean;
  healthObservedAt?: string | null;
  metricsObservedAt?: string | null;
  /** Job iniciado pelo usuário (teste SSH, sync, stack). Bloqueia sync em background. */
  activeJobId: string | null;
  /** Força coleta de saúde quando inventário da stack ainda está vazio. */
  needsStackScan?: boolean;
};

export function useAutoServerSync({
  serverId,
  enabled,
  healthObservedAt,
  metricsObservedAt,
  activeJobId,
  needsStackScan = false,
}: Options) {
  const qc = useQueryClient();
  const activeJobIdRef = useRef(activeJobId);
  activeJobIdRef.current = activeJobId;
  const inFlightRef = useRef(false);
  const lastSpawnAtRef = useRef(0);

  useEffect(() => {
    if (!enabled || !serverId) return;

    function scheduleRefresh() {
      window.setTimeout(() => {
        void qc.invalidateQueries({ queryKey: ["server", serverId] });
      }, 5000);
    }

    async function tick() {
      if (activeJobIdRef.current || inFlightRef.current) return;
      if (Date.now() - lastSpawnAtRef.current < SYNC_INTERVALS.checkMs) return;

      const healthStale =
        needsStackScan || isObservedStale(healthObservedAt, SYNC_INTERVALS.healthStaleMs);
      const metricsStale = isObservedStale(metricsObservedAt, SYNC_INTERVALS.metricsStaleMs);
      if (!healthStale && !metricsStale) return;

      inFlightRef.current = true;
      lastSpawnAtRef.current = Date.now();
      try {
        if (healthStale) {
          await apiFetch<{ jobId: string }>(`/servers/${serverId}/health`, { method: "POST" });
        } else if (metricsStale) {
          await apiFetch<{ jobId: string }>(`/servers/${serverId}/metrics`, { method: "POST" });
        }
        scheduleRefresh();
      } catch {
        /* próxima verificação tenta de novo */
      } finally {
        inFlightRef.current = false;
      }
    }

    void tick();
    const timer = setInterval(() => void tick(), SYNC_INTERVALS.checkMs);
    return () => clearInterval(timer);
  }, [enabled, serverId, healthObservedAt, metricsObservedAt, needsStackScan, qc]);
}
