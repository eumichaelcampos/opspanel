import { cn } from "@/lib/utils";

export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    healthy: "bg-success/10 text-success",
    pending: "bg-warning/10 text-warning",
    offline: "bg-danger/10 text-danger",
    succeeded: "bg-success/10 text-success",
    failed: "bg-danger/10 text-danger",
    queued: "bg-muted/10 text-muted",
    running: "bg-accent/10 text-accent",
  };
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", styles[status] ?? "bg-cool/30 text-ink")}>
      {status}
    </span>
  );
}
