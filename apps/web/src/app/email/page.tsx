"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { EmailHealthBadge } from "@/components/email-health-badge";
import { apiFetch } from "@/lib/api";
import { Mail } from "lucide-react";
import type { DnsAuthStatus } from "@opspanel/contracts";

type EmailHub = {
  provider: { mailboxConfigured: boolean; deliveryConfigured: boolean };
  quotas: {
    usage: { mailboxes: number; email_domains: number };
    limits: { mailboxes: number | null; email_domains: number | null };
  };
  domains: {
    id: string;
    domain: string;
    status: string;
    mailboxCount: number;
    errorMessage?: string | null;
    site?: { id: string; domain: string } | null;
  }[];
};

export default function EmailHubPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["email-hub"],
    queryFn: () => apiFetch<EmailHub>("/email"),
  });

  return (
    <AppShell title="E-mail">
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">E-mail da organização</h1>
            <p className="mt-1 text-sm text-muted">
              Caixas hospedadas fora dos servidores WordOps. Contratação separada do plano OpsPanel.
            </p>
          </div>
          <div className="rounded-card border border-ink/10 bg-white/60 px-4 py-2 text-sm">
            <p>
              {data?.quotas.limits.mailboxes === null
                ? `${data?.quotas.usage.mailboxes ?? 0} caixas (contrato ilimitado)`
                : (data?.quotas.limits.mailboxes ?? 0) === 0
                  ? "Nenhuma caixa contratada"
                  : `Caixas: ${data?.quotas.usage.mailboxes ?? 0} / ${data?.quotas.limits.mailboxes}`}
            </p>
            <p className="text-xs text-muted">
              Provedor caixas: {data?.provider.mailboxConfigured ? "Atriomail OK" : "Não configurado"}
              {" · "}
              Envio WP: {data?.provider.deliveryConfigured ? "Resend OK" : "Não configurado"}
            </p>
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted">Carregando…</p>
        ) : !data?.domains.length ? (
          <section className="glass-card p-6 text-sm text-muted">
            Nenhum domínio de e-mail ativo. Abra um site e use a aba <strong>E-mail</strong> para ativar.
          </section>
        ) : (
          <section className="glass-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink/10 bg-ink/5 text-left text-xs text-muted">
                  <th className="px-4 py-3">Domínio</th>
                  <th className="px-4 py-3">Site</th>
                  <th className="px-4 py-3">Caixas</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {data.domains.map((d) => (
                  <tr key={d.id} className="border-b border-ink/5 last:border-0">
                    <td className="px-4 py-3 font-mono">{d.domain}</td>
                    <td className="px-4 py-3">{d.site?.domain ?? "n/a"}</td>
                    <td className="px-4 py-3">{d.mailboxCount}</td>
                    <td className="px-4 py-3">
                      <EmailHealthBadge label={d.status} status={(d.status === "active" ? "ok" : d.status === "error" ? "invalid" : "unknown") as DnsAuthStatus} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {d.site ? (
                        <Link href={`/sites/${d.site.id}?tab=email`} className="text-accent hover:underline">
                          Gerenciar
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <section className="glass-card flex items-start gap-3 p-5 text-sm text-muted">
          <Mail className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
          <div>
            <p className="font-medium text-ink">Como funciona</p>
            <p className="mt-1">
              O OpsPanel provisiona caixas no Atriomail (API central) e publica MX/SPF/DKIM no Cloudflare. O VPS WordOps não
              roda Postfix nem consome RAM com e-mail. Caixas e domínios são add-ons pagos, definidos na licença de cada cliente.
            </p>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
