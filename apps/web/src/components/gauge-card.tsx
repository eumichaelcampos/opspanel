"use client";

type GaugeCardProps = {
  label: string;
  value: string;
  pct?: number;
  color?: "orange" | "blue" | "green" | "red";
};

const COLORS = {
  orange: { stroke: "#fb6340", bg: "rgba(251,99,64,0.12)" },
  blue: { stroke: "#5e72e4", bg: "rgba(94,114,228,0.12)" },
  green: { stroke: "#2dce89", bg: "rgba(45,206,137,0.12)" },
  red: { stroke: "#f5365c", bg: "rgba(245,54,92,0.12)" },
};

export function GaugeCard({ label, value, pct = 0, color = "blue" }: GaugeCardProps) {
  const c = COLORS[color];
  const clamped = Math.min(100, Math.max(0, pct));
  const r = 36;
  const circ = 2 * Math.PI * r;
  const offset = circ - (clamped / 100) * circ * 0.75;

  return (
    <div className="glass-card flex flex-col items-center p-4 text-center">
      <svg width="100" height="70" viewBox="0 0 100 70" className="mb-1">
        <path
          d="M 15 55 A 35 35 0 1 1 85 55"
          fill="none"
          stroke="#e9ecef"
          strokeWidth="8"
          strokeLinecap="round"
        />
        <path
          d="M 15 55 A 35 35 0 1 1 85 55"
          fill="none"
          stroke={c.stroke}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circ * 0.75}
          strokeDashoffset={offset}
        />
        <text x="50" y="52" textAnchor="middle" className="fill-ink text-sm font-semibold" fontSize="13">
          {value}
        </text>
      </svg>
      <p className="text-xs font-medium text-muted">{label}</p>
    </div>
  );
}
