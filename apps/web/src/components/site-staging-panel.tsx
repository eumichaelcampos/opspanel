"use client";

import { useState } from "react";
import { Copy, Loader2, RotateCcw } from "lucide-react";
import { suggestStagingDomain } from "@opspanel/contracts";

export function SiteStagingPanel({
  domain,
  disabled,
  clonePending,
  rollbackPending,
  onClone,
  onRollback,
  cloneError,
  rollbackError,
}: {
  domain: string;
  disabled?: boolean;
  clonePending?: boolean;
  rollbackPending?: boolean;
  onClone: (targetDomain: string, asStaging: boolean) => void;
  onRollback: () => void;
  cloneError?: string | null;
  rollbackError?: string | null;
}) {
  const [targetDomain, setTargetDomain] = useState(() => suggestStagingDomain(domain));
  const [asStaging, setAsStaging] = useState(true);
  const [confirmRollback, setConfirmRollback] = useState(false);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-ink">Clonar para staging</h3>
        <p className="mt-1 text-sm text-muted">
          Cria um site no mesmo servidor com cópia dos arquivos e, no WordPress, do banco com
          search-replace. Staging costuma usar <code className="rounded bg-ink/5 px-1 text-[11px]">staging.{"{domínio}"}</code>.
          SSL não é ativado automaticamente (configure DNS e Let&apos;s Encrypt depois).
        </p>
      </div>

      <div className="space-y-3">
        <label className="block text-sm font-medium text-ink">
          Domínio de destino
          <input
            className="mt-1 w-full rounded-card border border-ink/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-ink/20"
            value={targetDomain}
            onChange={(e) => setTargetDomain(e.target.value.toLowerCase().trim())}
            placeholder={suggestStagingDomain(domain)}
            disabled={disabled || clonePending}
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={asStaging}
            onChange={(e) => setAsStaging(e.target.checked)}
            disabled={disabled || clonePending}
          />
          Marcar como ambiente de staging (aparece no hub Staging)
        </label>
        <button
          type="button"
          className="btn-primary inline-flex items-center gap-2"
          disabled={disabled || clonePending || !targetDomain || targetDomain === domain.toLowerCase()}
          onClick={() => onClone(targetDomain, asStaging)}
        >
          {clonePending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
          {clonePending ? "Clonando…" : "Clonar site"}
        </button>
        {cloneError ? <p className="text-sm text-danger">{cloneError}</p> : null}
      </div>

      <div className="border-t border-ink/10 pt-5 dark:border-white/10">
        <h3 className="text-sm font-semibold text-ink">Rollback após atualização</h3>
        <p className="mt-1 text-sm text-muted">
          Restaura o backup local mais recente em modo completo (arquivos + banco). Antes, o OpsPanel
          cria um backup de segurança. Preferível ter um snapshot recente antes de atualizar core/plugins.
        </p>
        <button
          type="button"
          className="btn-secondary mt-3 inline-flex items-center gap-2 border-warning/40 text-warning hover:bg-warning/10"
          disabled={disabled || rollbackPending}
          onClick={() => setConfirmRollback(true)}
        >
          {rollbackPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
          {rollbackPending ? "Revertendo…" : "Rollback (último backup)"}
        </button>
        {rollbackError ? <p className="mt-2 text-sm text-danger">{rollbackError}</p> : null}
      </div>

      {confirmRollback ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-white/20 bg-white p-5 shadow-xl dark:bg-surface">
            <h4 className="font-semibold text-ink">Confirmar rollback</h4>
            <p className="mt-2 text-sm text-muted">
              O site <strong>{domain}</strong> será restaurado a partir do backup local mais recente
              (modo completo). Um backup de segurança será criado antes.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setConfirmRollback(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary bg-warning hover:bg-warning/90"
                onClick={() => {
                  setConfirmRollback(false);
                  onRollback();
                }}
              >
                Confirmar rollback
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
