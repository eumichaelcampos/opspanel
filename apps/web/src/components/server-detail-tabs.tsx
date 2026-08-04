"use client";

import { cn } from "@/lib/utils";
import { Activity, FolderOpen, Layers, ServerCog } from "lucide-react";

export type ServerDetailTab = "overview" | "stack" | "access" | "sites";

const TABS: { id: ServerDetailTab; label: string; icon: typeof Activity }[] = [
  { id: "overview", label: "Visão geral", icon: Activity },
  { id: "stack", label: "Stack & ops", icon: Layers },
  { id: "access", label: "Acesso", icon: ServerCog },
  { id: "sites", label: "Sites", icon: FolderOpen },
];

export function ServerDetailTabs({
  active,
  onChange,
  siteCount,
}: {
  active: ServerDetailTab;
  onChange: (tab: ServerDetailTab) => void;
  siteCount?: number;
}) {
  return (
    <nav className="flex flex-wrap gap-1 rounded-shell border border-white/60 bg-white/50 p-1">
      {TABS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition",
            active === id ? "bg-white text-ink shadow-sm" : "text-muted hover:bg-white/60 hover:text-ink",
          )}
        >
          <Icon className="h-4 w-4 shrink-0" />
          {label}
          {id === "sites" && siteCount != null && siteCount > 0 ? (
            <span className="rounded-full bg-accent/15 px-1.5 text-[10px] text-accent">{siteCount}</span>
          ) : null}
        </button>
      ))}
    </nav>
  );
}
