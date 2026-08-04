"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { Globe, Plus } from "lucide-react";

export function SitesSubNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const serverId = searchParams.get("serverId");
  const isNew = pathname === "/sites/new";

  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <nav className="flex flex-wrap gap-1 rounded-shell border border-white/60 bg-white/50 p-1">
        <Link
          href="/sites"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition",
            pathname === "/sites" && !serverId
              ? "bg-white text-ink shadow-sm"
              : "text-muted hover:bg-white/60 hover:text-ink",
          )}
        >
          <Globe className="h-4 w-4" />
          Todos
        </Link>
        {serverId ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-sm font-medium text-ink shadow-sm">
            Filtrado por servidor
          </span>
        ) : null}
      </nav>
      {!isNew ? (
        <Link
          href="/sites/new"
          className="inline-flex items-center gap-2 rounded-card bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          Criar site
        </Link>
      ) : null}
    </div>
  );
}
