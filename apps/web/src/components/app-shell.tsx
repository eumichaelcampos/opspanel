"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Server,
  Globe,
  Mail,
  ListTodo,
  Shield,
  LogOut,
  Hexagon,
  Plus,
  BarChart3,
  Bot,
  User,
  ShieldCheck,
  LayoutTemplate,
  Archive,
  Network,
  Copy,
  Workflow,
} from "lucide-react";
import { UpdateNotification } from "@/components/update-notification";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";

const mainNav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/servers", label: "Servidores", icon: Server },
  { href: "/sites", label: "Sites", icon: Globe },
  { href: "/wordpress", label: "WordPress", icon: LayoutTemplate },
  { href: "/staging", label: "Staging", icon: Copy },
  { href: "/backups", label: "Backups", icon: Archive },
  { href: "/dns", label: "DNS", icon: Network },
  { href: "/email", label: "E-mail", icon: Mail },
  { href: "/security", label: "Segurança", icon: ShieldCheck },
  { href: "/automation", label: "Automação", icon: Workflow, match: ["/automation", "/performance", "/alerts"] },
  { href: "/reports", label: "Relatórios", icon: BarChart3 },
  { href: "/assistant", label: "Assistente IA", icon: Bot },
];

const opsNav = [
  { href: "/jobs", label: "Jobs", icon: ListTodo },
  { href: "/audit", label: "Auditoria", icon: Shield },
];

const settingsNav = [{ href: "/settings", label: "Conta", icon: User }];

function initials(email?: string, name?: string | null): string {
  if (name?.trim()) return name.trim().slice(0, 2).toUpperCase();
  if (!email) return "OP";
  const part = email.split("@")[0] ?? "OP";
  return part.slice(0, 2).toUpperCase();
}

function NavSection({
  title,
  items,
  pathname,
}: {
  title: string;
  items: { href: string; label: string; icon: typeof LayoutDashboard; match?: string[] }[];
  pathname: string;
}) {
  return (
    <div>
      <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted/80">{title}</p>
      <div className="flex flex-col gap-0.5">
        {items.map((item) => {
          const Icon = item.icon;
          const active = item.match
            ? item.match.some((m) => pathname === m || pathname.startsWith(`${m}/`))
            : pathname === item.href ||
              (item.href !== "/dashboard" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                active
                  ? "bg-[color:var(--nav-active-bg)] text-[color:var(--nav-active-fg)] shadow-sm dark:shadow-glow-accent/30"
                  : "text-muted hover:bg-[color:var(--nav-hover-bg)] hover:text-ink",
              )}
            >
              {active ? (
                <span className="absolute left-0 top-1/2 hidden h-6 w-1 -translate-y-1/2 rounded-r-full bg-accent dark:block" />
              ) : null}
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function AppShell({ children, title }: { children: React.ReactNode; title: string }) {
  const pathname = usePathname();
  const qc = useQueryClient();

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: () =>
      apiFetch<{
        user: { email: string; role: string; name?: string | null; organizationName?: string };
      }>("/me"),
  });

  async function logout() {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } catch {
      /* encerra sessão local mesmo se a API falhar */
    }
    qc.clear();
    window.location.href = "/login?logout=1";
  }

  const isDashboard = pathname === "/dashboard";
  const displayName = me?.user.name ?? me?.user.email?.split("@")[0] ?? "Admin";

  return (
    <div className="mx-auto flex min-h-screen max-w-[1680px] gap-5 p-4 lg:gap-6 lg:p-6">
      <aside className="glass-panel sticky top-4 hidden h-[calc(100vh-2rem)] w-[240px] shrink-0 flex-col lg:top-6 lg:flex lg:h-[calc(100vh-3rem)]">
        <div className="flex shrink-0 items-center gap-3 px-6 pb-4 pt-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 text-accent">
            <Hexagon className="h-5 w-5" strokeWidth={2.2} />
          </div>
          <div>
            <p className="text-base font-semibold text-ink">OpsPanel</p>
            <p className="text-[11px] text-muted">WordOps Control Plane</p>
          </div>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 pb-4">
          <NavSection title="Menu principal" items={mainNav} pathname={pathname} />
          <NavSection title="Operações" items={opsNav} pathname={pathname} />
          <NavSection title="Conta" items={settingsNav} pathname={pathname} />
        </nav>

        <div className="mt-auto shrink-0 space-y-2 border-t border-ink/10 px-5 py-4 dark:border-white/10">
          <Link
            href="/servers/new"
            className="flex items-center justify-center gap-2 rounded-xl bg-accent px-3 py-2.5 text-sm font-medium text-white shadow-sm transition hover:opacity-95 dark:shadow-glow-accent"
          >
            <Plus className="h-4 w-4" />
            Novo servidor
          </Link>

          <button
            type="button"
            onClick={() => void logout()}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-ink/10 bg-surface/40 px-3 py-2.5 text-sm font-medium text-muted transition hover:bg-surface/70 hover:text-ink dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
          >
            <LogOut className="h-4 w-4" />
            Sair
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <UpdateNotification />
        <header className="glass-panel flex items-center justify-between gap-4 px-5 py-4 lg:px-6">
          <div>
            <p className="text-xs text-muted">{me?.user.organizationName ?? "Organização"}</p>
            <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <ThemeToggle />
            <Link href="/settings/profile" className="flex items-center gap-3 transition hover:opacity-90">
              <div className="hidden text-right sm:block">
                <p className="text-sm font-medium text-ink">{displayName}</p>
                <p className="text-xs capitalize text-muted">{me?.user.role ?? "operador"}</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-accent/80 to-accent text-sm font-semibold text-white shadow-sm dark:from-violet-400 dark:to-indigo-500">
                {initials(me?.user.email, me?.user.name)}
              </div>
            </Link>
          </div>
        </header>

        <main className={cn("flex-1", isDashboard ? "" : "glass-panel p-5 lg:p-6")}>{children}</main>
      </div>
    </div>
  );
}
