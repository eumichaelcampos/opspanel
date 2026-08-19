"use client";

import { resolveSiteInventory, type SiteInventoryItem, type SiteInfoSnapshot } from "@opspanel/contracts";

function InventoryChip({ item, variant }: { item: SiteInventoryItem; variant: "active" | "inactive" }) {
  const cls =
    variant === "active"
      ? "border-success/40 bg-success/10 text-success"
      : "border-white/80 bg-white/70 text-muted";
  return (
    <span
      className={`inline-flex max-w-full flex-col items-start gap-0.5 rounded-full border px-2.5 py-1 text-xs sm:inline-flex sm:flex-row sm:items-center sm:gap-1 ${cls}`}
      title={item.detail}
    >
      <span>{item.label}</span>
      {item.detail && variant === "active" ? (
        <span className="hidden opacity-70 sm:inline">· {item.detail}</span>
      ) : null}
    </span>
  );
}

export function SiteInventorySummary({
  infoSnapshot,
  compact = false,
}: {
  infoSnapshot?: SiteInfoSnapshot | null;
  compact?: boolean;
}) {
  const inventory = resolveSiteInventory(infoSnapshot);

  if (inventory.needsRefresh) {
    return (
      <div className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-muted">
        Inventário do site pendente. Será atualizado na próxima sincronização.
      </div>
    );
  }

  if (compact) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {inventory.active.map((item) => (
          <InventoryChip key={item.id} item={item} variant="active" />
        ))}
        {inventory.active.length === 0 ? (
          <span className="text-xs text-muted">Nenhum recurso detectado ainda.</span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className="font-medium text-ink">{inventory.active.length} ativos</span>
        <span>·</span>
        <span>{inventory.inactive.length} inativos</span>
      </div>

      {inventory.active.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted">Recursos ativos</p>
          <div className="flex flex-wrap gap-2">
            {inventory.active.map((item) => (
              <InventoryChip key={item.id} item={item} variant="active" />
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted">Aguardando detecção dos recursos do site.</p>
      )}

      {inventory.inactive.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted">Recursos inativos ou não configurados</p>
          <div className="flex flex-wrap gap-2">
            {inventory.inactive.map((item) => (
              <InventoryChip key={item.id} item={item} variant="inactive" />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
