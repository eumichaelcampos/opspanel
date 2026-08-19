"use client";

import { Globe, Loader2, Shield } from "lucide-react";

type Props = {
  domain: string;
  disabled?: boolean;
  pending?: boolean;
  newDomain: string;
  onNewDomainChange: (value: string) => void;
  onSubmit: () => void;
  error?: string | null;
};

export function SiteDomainPanel({
  domain,
  disabled = false,
  pending = false,
  newDomain,
  onNewDomainChange,
  onSubmit,
  error,
}: Props) {
  return (
    <div className="space-y-5">
      <div className="rounded-card border border-accent/20 bg-accent/5 px-4 py-3 text-sm text-muted">
        <p className="flex items-start gap-2">
          <Shield className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <span>
            Altere o endereço do site no servidor WordOps. Um backup completo é criado automaticamente antes da
            troca. URLs e configurações WordPress são atualizadas quando aplicável.
          </span>
        </p>
      </div>

      <section className="glass-card space-y-4 p-5">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-accent" />
          <h3 className="font-semibold text-ink">Trocar domínio</h3>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium text-muted">Domínio atual</span>
            <input
              className="w-full rounded-card border border-ink/20 bg-ink/5 px-3 py-2 text-sm"
              value={domain}
              disabled
            />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium text-ink">Novo domínio</span>
            <input
              className="w-full rounded-card border border-ink/20 bg-white px-3 py-2 text-sm focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
              placeholder="novodominio.com.br"
              value={newDomain}
              onChange={(e) => onNewDomainChange(e.target.value)}
              disabled={disabled || pending}
            />
          </label>
        </div>

        <p className="text-xs text-muted">
          Após a troca, atualize o DNS do novo domínio para apontar ao servidor e configure SSL em Ajustes, se
          necessário.
        </p>

        {error ? <p className="text-sm text-danger">{error}</p> : null}

        <button
          type="button"
          disabled={disabled || pending || !newDomain.trim() || newDomain.trim().toLowerCase() === domain.toLowerCase()}
          onClick={onSubmit}
          className="inline-flex items-center gap-2 rounded-card bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-60"
        >
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Iniciando troca…
            </>
          ) : (
            <>
              <Globe className="h-4 w-4" />
              Confirmar troca de domínio
            </>
          )}
        </button>
      </section>
    </div>
  );
}
