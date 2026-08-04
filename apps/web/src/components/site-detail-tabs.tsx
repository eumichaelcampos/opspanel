"use client";

import { cn } from "@/lib/utils";
import { Activity, Database, FolderOpen, Settings2, ShieldAlert, Upload, Users } from "lucide-react";

export type SiteDetailTab = "overview" | "files" | "database" | "ops" | "access" | "danger";

const TABS: { id: SiteDetailTab; label: string; icon: typeof Activity }[] = [
  { id: "overview", label: "Visão geral", icon: Activity },
  { id: "files", label: "Arquivos", icon: FolderOpen },
  { id: "database", label: "Banco", icon: Database },
  { id: "ops", label: "Ops & backup", icon: Settings2 },
  { id: "access", label: "FTP", icon: Users },
  { id: "danger", label: "Excluir", icon: ShieldAlert },
];

export function SiteDetailTabs({
  active,
  onChange,
}: {
  active: SiteDetailTab;
  onChange: (tab: SiteDetailTab) => void;
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
            id === "danger" && active !== id && "text-danger/80 hover:text-danger",
          )}
        >
          <Icon className="h-4 w-4 shrink-0" />
          {label}
        </button>
      ))}
    </nav>
  );
}
