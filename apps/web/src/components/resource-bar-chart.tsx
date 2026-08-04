"use client";

type BarItem = {
  label: string;
  value: number;
  sublabel?: string;
};

type ResourceBarChartProps = {
  title: string;
  items: BarItem[];
  unit?: string;
  max?: number;
};

export function ResourceBarChart({ title, items, unit = "%", max = 100 }: ResourceBarChartProps) {
  const peak = Math.max(max, ...items.map((i) => i.value), 1);

  return (
    <div>
      <p className="mb-4 text-sm font-medium text-muted">{title}</p>
      <div className="flex items-end justify-between gap-2 sm:gap-3" style={{ minHeight: 140 }}>
        {items.map((item) => {
          const h = Math.max(8, Math.round((item.value / peak) * 120));
          const tone = item.value >= 90 ? "from-danger to-danger/60" : item.value >= 75 ? "from-warning to-warning/60" : "from-accent to-accent/50";
          return (
            <div key={item.label} className="flex min-w-0 flex-1 flex-col items-center gap-2">
              <span className="text-xs font-semibold text-ink">
                {item.value}
                {unit}
              </span>
              <div
                className={`w-full max-w-[48px] rounded-t-lg bg-gradient-to-t ${tone} transition-all`}
                style={{ height: h }}
                title={`${item.label}: ${item.value}${unit}`}
              />
              <div className="w-full text-center">
                <p className="truncate text-[10px] font-medium text-ink">{item.label}</p>
                {item.sublabel ? <p className="truncate text-[9px] text-muted">{item.sublabel}</p> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
