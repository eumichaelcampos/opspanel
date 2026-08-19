import { cn } from "@/lib/utils";
import type { DnsAuthStatus } from "@opspanel/contracts";

const LABELS: Record<DnsAuthStatus, string> = {
  ok: "OK",
  missing: "Ausente",
  invalid: "Inválido",
  unknown: "Desconhecido",
};

const STYLES: Record<DnsAuthStatus, string> = {
  ok: "border-success/30 bg-success/10 text-success",
  missing: "border-warning/30 bg-warning/10 text-warning",
  invalid: "border-danger/30 bg-danger/10 text-danger",
  unknown: "border-ink/10 bg-ink/5 text-muted",
};

export function EmailHealthBadge({ label, status }: { label: string; status: DnsAuthStatus }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium", STYLES[status])}>
      <span className="font-semibold">{label}</span>
      <span>{LABELS[status]}</span>
    </span>
  );
}
