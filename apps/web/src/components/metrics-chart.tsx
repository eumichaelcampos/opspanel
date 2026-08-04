"use client";

type MetricsChartProps = {
  label: string;
  labels: string[];
  points: Array<number[] | string>;
  dimensionIndex?: number;
};

export function MetricsChart({ label, labels, points, dimensionIndex = 1 }: MetricsChartProps) {
  const values = points
    .map((row) => {
      if (Array.isArray(row)) {
        const v = row[dimensionIndex];
        return typeof v === "number" && Number.isFinite(v) ? v : 0;
      }
      if (typeof row === "string") {
        const parts = row.trim().split(/\s+/);
        const v = Number(parts[dimensionIndex] ?? parts[1]);
        return Number.isFinite(v) ? v : 0;
      }
      return 0;
    })
    .filter((v) => Number.isFinite(v));

  if (!values.length) {
    return (
      <div className="rounded-card border border-white/80 bg-white/90 p-3">
        <p className="mb-2 text-sm font-medium">{label}</p>
        <p className="text-xs text-muted">Sem dados de série temporal.</p>
      </div>
    );
  }

  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const w = 280;
  const h = 80;
  const pad = 4;

  const coords = values.map((v, i) => {
    const x = pad + (i / Math.max(values.length - 1, 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / Math.max(max - min, 1)) * (h - pad * 2);
    return `${x},${y}`;
  });

  const dimName = labels[dimensionIndex] ?? "value";

  return (
    <div className="rounded-card border border-white/80 bg-white/90 p-3">
      <p className="mb-2 text-sm font-medium">{label}</p>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none">
        <polyline
          fill="none"
          stroke="#5e72e4"
          strokeWidth="2"
          points={coords.join(" ")}
        />
        <polyline
          fill="rgba(94,114,228,0.15)"
          stroke="none"
          points={`${pad},${h - pad} ${coords.join(" ")} ${w - pad},${h - pad}`}
        />
      </svg>
      <p className="mt-1 text-[10px] text-muted">
        {dimName} · últimos {values.length} pontos · max {max.toFixed(1)}
      </p>
    </div>
  );
}
