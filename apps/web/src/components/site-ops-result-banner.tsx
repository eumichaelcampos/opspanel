"use client";

import { CheckCircle2, XCircle, X } from "lucide-react";

export function SiteOpsResultBanner({
  status,
  title,
  message,
  onDismiss,
}: {
  status: "success" | "error";
  title: string;
  message: string;
  onDismiss: () => void;
}) {
  const ok = status === "success";
  return (
    <div
      className={`flex items-start gap-3 rounded-card border px-4 py-3 ${
        ok ? "border-success/40 bg-success/10 text-success" : "border-danger/40 bg-danger/10 text-danger"
      }`}
      role="status"
    >
      {ok ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /> : <XCircle className="mt-0.5 h-5 w-5 shrink-0" />}
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        <p className={`mt-0.5 text-sm ${ok ? "text-success/90" : "text-danger/90"}`}>{message}</p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded p-1 opacity-70 hover:opacity-100"
        aria-label="Fechar"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
