"use client";

import { useEffect, useRef } from "react";
import { apiFetch } from "@/lib/api";
import { isObservedStale, SYNC_INTERVALS } from "@/lib/auto-sync";

type Options = {
  serverId: string;
  enabled: boolean;
  healthObservedAt?: string | null;
  metricsObservedAt?: string | null;
  activeJobId: string | null;
  onJobStarted: (jobId: string) => void;
  /** Força coleta de saúde quando inventário da stack ainda está vazio. */
  needsStackScan?: boolean;
};

export function useAutoServerSync({
  serverId,
  enabled,
  healthObservedAt,
  metricsObservedAt,
  activeJobId,
  onJobStarted,
  needsStackScan = false,
}: Options) {
  const onJobStartedRef = useRef(onJobStarted);
  onJobStartedRef.current = onJobStarted;
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!enabled || !serverId) return;

    async function tick() {
      if (activeJobId || inFlightRef.current) return;

      const healthStale =
        needsStackScan || isObservedStale(healthObservedAt, SYNC_INTERVALS.healthStaleMs);
      const metricsStale = isObservedStale(metricsObservedAt, SYNC_INTERVALS.metricsStaleMs);
      if (!healthStale && !metricsStale) return;

      inFlightRef.current = true;
      try {
        if (healthStale) {
          const result = await apiFetch<{ jobId: string }>(`/servers/${serverId}/health`, {
            method: "POST",
          });
          onJobStartedRef.current(result.jobId);
        } else if (metricsStale) {
          const result = await apiFetch<{ jobId: string }>(`/servers/${serverId}/metrics`, {
            method: "POST",
          });
          onJobStartedRef.current(result.jobId);
        }
      } catch {
        /* próxima verificação tenta de novo */
      } finally {
        inFlightRef.current = false;
      }
    }

    void tick();
    const timer = setInterval(() => void tick(), SYNC_INTERVALS.checkMs);
    return () => clearInterval(timer);
  }, [enabled, serverId, healthObservedAt, metricsObservedAt, activeJobId, needsStackScan]);
}
