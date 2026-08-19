"use client";

type MetricBarProps = {
  label: string;
  pct?: number;
  detail?: string;
};

export function MetricBar({ label, pct, detail }: MetricBarProps) {
  const level = pct == null ? "ok" : pct >= 90 ? "critical" : pct >= 75 ? "warn" : "ok";
  const barColor = level === "critical" ? "bg-danger" : level === "warn" ? "bg-warning" : "bg-success";
  const display = detail ?? (pct != null ? `${pct}%` : "—");

  return (
    <div className="space-y-1">
      {label ? (
        <div className="flex justify-between text-sm">
          <span className="text-muted">{label}</span>
          <span className="font-medium">{display}</span>
        </div>
      ) : (
        <div className="text-right text-xs font-medium">{display}</div>
      )}
      <div className="h-2 overflow-hidden rounded-full bg-white/60">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct ?? 0}%` }} />
      </div>
    </div>
  );
}
