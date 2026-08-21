"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Gauge, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/performance", label: "Performance", icon: Gauge },
  { href: "/automation", label: "Playbooks", icon: Workflow },
  { href: "/alerts", label: "Alertas", icon: Bell },
] as const;

export function AutomationSubNav() {
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
