"use client";

type DistributionBarProps = {
  label: string;
  value: number;
  total: number;
  color?: string;
};

export function DistributionBar({ label, value, total, color = "bg-accent" }: DistributionBarProps) {
  const pct = total > 0 ? Math.round((value / total) * 1000) / 10 : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted">{label}</span>
        <span className="font-medium text-ink">
          {value} <span className="text-xs text-muted">({pct}%)</span>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/50">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
