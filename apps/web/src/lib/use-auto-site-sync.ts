"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { isObservedStale, SYNC_INTERVALS } from "@/lib/auto-sync";

type Options = {
  siteId: string;
  enabled: boolean;
  lastObservedAt?: string | null;
  activeJobId: string | null;
};

export function useAutoSiteSync({ siteId, enabled, lastObservedAt, activeJobId }: Options) {
  const qc = useQueryClient();
  const activeJobIdRef = useRef(activeJobId);
  activeJobIdRef.current = activeJobId;
  const inFlightRef = useRef(false);
  const lastSpawnAtRef = useRef(0);

  useEffect(() => {
    if (!enabled || !siteId) return;

    async function tick() {
      if (activeJobIdRef.current || inFlightRef.current) return;
      if (Date.now() - lastSpawnAtRef.current < SYNC_INTERVALS.checkMs) return;
      if (!isObservedStale(lastObservedAt, SYNC_INTERVALS.siteInfoStaleMs)) return;

      inFlightRef.current = true;
      lastSpawnAtRef.current = Date.now();
      try {
        await apiFetch<{ jobId: string }>(`/sites/${siteId}/info`, { method: "POST" });
        window.setTimeout(() => {
          void qc.invalidateQueries({ queryKey: ["site", siteId] });
        }, 5000);
      } catch {
        /* próxima verificação tenta de novo */
      } finally {
        inFlightRef.current = false;
      }
    }

    void tick();
    const timer = setInterval(() => void tick(), SYNC_INTERVALS.checkMs);
    return () => clearInterval(timer);
  }, [enabled, siteId, lastObservedAt, qc]);
}
