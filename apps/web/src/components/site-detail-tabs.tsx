"use client";

import { cn } from "@/lib/utils";
import { Activity, Archive, Cloud, Copy, Database, FolderOpen, Globe, LayoutTemplate, Mail, ShieldAlert, Users, Wrench } from "lucide-react";

export type SiteDetailTab =
  | "overview"
  | "files"
  | "database"
  | "ops"
  | "wordpress"
  | "staging"
  | "backup"
  | "domain"
  | "cloudflare"
  | "email"
  | "access"
  | "danger";

const TABS: { id: SiteDetailTab; label: string; icon: typeof Activity }[] = [
  { id: "overview", label: "Visão geral", icon: Activity },
  { id: "files", label: "Arquivos", icon: FolderOpen },
  { id: "database", label: "Banco", icon: Database },
  { id: "ops", label: "Ajustes", icon: Wrench },
  { id: "wordpress", label: "WordPress", icon: LayoutTemplate },
  { id: "staging", label: "Staging", icon: Copy },
  { id: "backup", label: "Backup", icon: Archive },
  { id: "domain", label: "Domínio", icon: Globe },
  { id: "cloudflare", label: "Cloudflare", icon: Cloud },
  { id: "email", label: "E-mail", icon: Mail },
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
