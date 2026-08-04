"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { apiFetch } from "@/lib/api";

const BYPASS = ["/login", "/setup"];

export function SetupRedirect({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (BYPASS.some((p) => pathname.startsWith(p))) return;
    void apiFetch<{ setup: { needsSetup: boolean } }>("/setup/status")
      .then((data) => {
        if (data.setup.needsSetup) router.replace("/setup");
      })
      .catch(() => undefined);
  }, [pathname, router]);

  return children;
}
