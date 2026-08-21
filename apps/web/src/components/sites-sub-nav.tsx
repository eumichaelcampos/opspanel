"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { Globe, Plus, Upload, X } from "lucide-react";

export function SitesSubNav() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const serverId = searchParams.get("serverId");
  const isNew = pathname === "/sites/new";
  const isMigrate = pathname === "/sites/migrate";

  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <nav className="flex flex-wrap gap-1 rounded-shell border border-ink/10 bg-surface/40 p-1 dark:border-white/10 dark:bg-white/[0.03]">
        <Link
          href="/sites"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition",
            pathname === "/sites" && !serverId
              ? "bg-surface text-ink shadow-sm dark:bg-accent/20 dark:text-white"
              : "text-muted hover:bg-surface/70 hover:text-ink dark:hover:bg-white/5",
          )}
        >
          <Globe className="h-4 w-4" />
          Todos
        </Link>
        {serverId ? (
          <button
            type="button"
            onClick={() => router.replace("/sites")}
            className="inline-flex items-center gap-1.5 rounded-lg bg-surface px-3 py-2 text-sm font-medium text-ink shadow-sm dark:bg-accent/20 dark:text-white"
          >
            Filtrado por servidor
            <X className="h-3.5 w-3.5 text-muted" />
          </button>
        ) : null}
      </nav>
      {!isNew && !isMigrate ? (
        <div className="flex flex-wrap gap-2">
          <Link href="/sites/new" className="btn-primary">
            <Plus className="h-4 w-4" />
            Criar site
          </Link>
          <Link href="/sites/migrate" className="btn-accent-outline">
            <Upload className="h-4 w-4" />
            Migrar via FTP
          </Link>
        </div>
      ) : null}
    </div>
  );
}
