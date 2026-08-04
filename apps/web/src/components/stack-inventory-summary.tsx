"use client";

import { resolveExistingServerInventory, type StackInventoryItem } from "@opspanel/contracts";

function InventoryChip({ item, variant }: { item: StackInventoryItem; variant: "installed" | "available" }) {
  const cls =
    variant === "installed"
      ? item.running
        ? "border-success/40 bg-success/10 text-success"
        : "border-warning/40 bg-warning/10 text-warning"
      : "border-white/80 bg-white/70 text-muted";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs ${cls}`}>
      {item.label}
      {variant === "installed" ? (
        <span className="opacity-70">· {item.running ? "rodando" : item.status}</span>
      ) : null}
    </span>
  );
}

export function StackInventorySummary({
  wordopsVersion,
  siteCount,
  lastSyncedAt,
  stackComponents,
  compact = false,
}: {
  wordopsVersion?: string | null;
  siteCount?: number;
  lastSyncedAt?: string | null;
  stackComponents?: { id: string; installed: boolean; running: boolean; status: string }[];
  compact?: boolean;
}) {
  const inventory = resolveExistingServerInventory({
    wordopsVersion,
    siteCount: siteCount ?? 0,
    lastSyncedAt,
    stackComponents,
    credentialConfigured: true,
    status: "healthy",
    lastConnectedAt: null,
    onboardingSnapshot: null,
    onboardingCompletedAt: null,
  });

  if (inventory.needsHealthScan) {
    return (
      <div className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-muted">
        Inventário da stack pendente. Será atualizado após cada instalação ou ao concluir o onboarding.
      </div>
    );
  }

  if (compact) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {inventory.installed.map((item) => (
          <InventoryChip key={item.id} item={item} variant="installed" />
        ))}
        {inventory.installed.length === 0 ? (
          <span className="text-xs text-muted">Nenhum componente detectado ainda.</span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className="font-medium text-ink">{inventory.installed.length} instalados</span>
        <span>·</span>
        <span>{inventory.available.length} disponíveis</span>
      </div>
      {inventory.installed.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {inventory.installed.map((item) => (
            <InventoryChip key={item.id} item={item} variant="installed" />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted">Aguardando detecção dos componentes WordOps.</p>
      )}
    </div>
  );
}
