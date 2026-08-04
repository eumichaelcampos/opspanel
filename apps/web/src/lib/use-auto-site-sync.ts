"use client";

import { useEffect, useRef } from "react";
import { apiFetch } from "@/lib/api";
import { isObservedStale, SYNC_INTERVALS } from "@/lib/auto-sync";

type Options = {
  siteId: string;
  enabled: boolean;
  lastObservedAt?: string | null;
  activeJobId: string | null;
  onJobStarted: (jobId: string) => void;
};

export function useAutoSiteSync({
  siteId,
  enabled,
  lastObservedAt,
  activeJobId,
  onJobStarted,
}: Options) {
  const onJobStartedRef = useRef(onJobStarted);
  onJobStartedRef.current = onJobStarted;
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!enabled || !siteId) return;

    async function tick() {
      if (activeJobId || inFlightRef.current) return;
      if (!isObservedStale(lastObservedAt, SYNC_INTERVALS.siteInfoStaleMs)) return;

      inFlightRef.current = true;
      try {
        const result = await apiFetch<{ jobId: string }>(`/sites/${siteId}/info`, { method: "POST" });
        onJobStartedRef.current(result.jobId);
      } catch {
        /* próxima verificação tenta de novo */
      } finally {
        inFlightRef.current = false;
      }
    }

    void tick();
    const timer = setInterval(() => void tick(), SYNC_INTERVALS.checkMs);
    return () => clearInterval(timer);
  }, [enabled, siteId, lastObservedAt, activeJobId]);
}
