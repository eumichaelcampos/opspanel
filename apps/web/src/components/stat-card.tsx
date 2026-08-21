"use client";

import type { LucideIcon } from "lucide-react";
import { Sparkline } from "@/components/sparkline";
import { cn } from "@/lib/utils";

type StatCardProps = {
  label: string;
  value: string | number;
  hint?: string;
  trend?: { value: string; positive?: boolean };
  icon: LucideIcon;
  iconClass?: string;
  spark?: number[];
};

export function StatCard({ label, value, hint, trend, icon: Icon, iconClass, spark }: StatCardProps) {
  return (
    <div className="glass-card group relative overflow-hidden p-5 transition hover:shadow-lg dark:hover:shadow-glow-accent/40">
      <div className="flex items-start justify-between gap-3">
        <div
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl shadow-sm",
            iconClass ?? "bg-accent/15 text-accent",
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
        {spark && spark.length > 1 ? (
          <Sparkline
            data={spark}
            className="opacity-70"
            color={trend?.positive === false ? "#F87171" : trend?.positive ? "#2DD4BF" : "#8B5CF6"}
          />
        ) : null}
      </div>
      <p className="mt-4 text-sm text-muted">{label}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight text-ink">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
      {trend ? (
        <p className={cn("mt-2 text-xs font-medium", trend.positive ? "text-success" : trend.positive === false ? "text-danger" : "text-muted")}>
          {trend.value}
        </p>
      ) : null}
    </div>
  );
}
