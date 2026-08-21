"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, CreditCard, Link2, User } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/settings/profile", label: "Perfil", icon: User },
  { href: "/settings/instance", label: "Empresa", icon: Building2 },
  { href: "/settings/account", label: "Integrações", icon: Link2 },
  { href: "/settings/plan", label: "Plano", icon: CreditCard },
] as const;

export function SettingsSubNav() {
  const pathname = usePathname();

  return (
    <nav className="mb-6 flex flex-wrap gap-1 rounded-shell border border-ink/10 bg-surface/40 p-1 dark:border-white/10 dark:bg-white/[0.03]">
      {TABS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition",
              active
                ? "bg-surface text-ink shadow-sm dark:bg-accent/20 dark:text-white dark:shadow-glow-accent/20"
                : "text-muted hover:bg-surface/70 hover:text-ink dark:hover:bg-white/5",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
