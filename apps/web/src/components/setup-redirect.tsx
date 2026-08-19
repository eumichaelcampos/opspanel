"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

const BYPASS = ["/login", "/setup"];

export function SetupRedirect({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const skip = BYPASS.some((p) => pathname.startsWith(p));

  const { data } = useQuery({
    queryKey: ["setup-status"],
    queryFn: () => apiFetch<{ setup: { needsSetup: boolean } }>("/setup/status"),
    enabled: !skip,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!skip && data?.setup.needsSetup) {
      router.replace("/setup");
    }
  }, [skip, data?.setup.needsSetup, router]);

  return children;
}
