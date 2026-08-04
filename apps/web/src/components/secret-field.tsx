"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  value: string;
  className?: string;
  mono?: boolean;
  multiline?: boolean;
};

export function SecretField({ value, className, mono = true, multiline = false }: Props) {
  const [visible, setVisible] = useState(false);

  const masked = "•".repeat(Math.min(Math.max(value.length, 8), 24));

  return (
    <div className={cn("flex items-start gap-2", className)}>
      {multiline && visible ? (
        <pre className="max-h-40 flex-1 overflow-auto whitespace-pre-wrap break-all rounded-md border border-white/60 bg-white/80 p-2 font-mono text-[11px]">
          {value}
        </pre>
      ) : (
        <span className={cn("min-w-0 flex-1 break-all text-sm", mono && "font-mono text-xs")}>
          {visible ? value : masked}
        </span>
      )}
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="shrink-0 rounded p-1 text-muted hover:bg-white/80 hover:text-ink"
        aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
        title={visible ? "Ocultar" : "Mostrar"}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}
