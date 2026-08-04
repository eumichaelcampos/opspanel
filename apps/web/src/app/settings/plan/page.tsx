"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Check, CreditCard, ExternalLink, RefreshCw } from "lucide-react";

type LicenseResponse = {
  license: {
    instanceId: string;
    plan: string;
    status: string;
    validUntil: string | null;
    lastSyncAt: string | null;
    licenseKeyConfigured: boolean;
    cloudConnected: boolean;
    lastSyncError: string | null;
    billing?: {
      enabled: boolean;
      subscriptionStatus: string | null;
      currentPeriodEnd: string | null;
      cancelAtPeriodEnd: boolean;
      managedByStripe: boolean;
    };
  };
  usage: {
    plan: string;
    usage: Record<string, number>;
    limits: Record<string, number | null>;
  };
};

type BillingPlan = {
  id: string;
  name: string;
  description: string;
  priceMonthly: number | null;
  currency: string;
  features: string[];
  upgradable: boolean;
};

function UsageBar({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : used > 0 ? 8 : 0;
  const limitLabel = limit === null ? "ilimitado" : String(limit);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-muted">{label}</span>
        <span className="font-medium text-ink">
          {used} / {limitLabel}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/60">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${limit ? pct : 0}%` }} />
      </div>
    </div>
  );
}

function formatPrice(plan: BillingPlan): string {
  if (plan.priceMonthly === null || plan.priceMonthly === 0) return "Grátis";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: plan.currency,
  }).format(plan.priceMonthly);
}

export default function PlanSettingsPage() {
  const qc = useQueryClient();
  const [billingResult, setBillingResult] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setBillingResult(params.get("billing"));
  }, []);

  const { data, isLoading, error } = useQuery({
    queryKey: ["license"],
    queryFn: () => apiFetch<LicenseResponse>("/license"),
  });

  const { data: billingPlans } = useQuery({
    queryKey: ["license", "billing", "plans"],
    queryFn: () => apiFetch<{ enabled: boolean; plans: BillingPlan[] }>("/license/billing/plans"),
    enabled: Boolean(data?.license.cloudConnected),
  });

  const syncMutation = useMutation({
    mutationFn: () => apiFetch("/license/sync", { method: "POST" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["license"] }),
  });

  const checkoutMutation = useMutation({
    mutationFn: (plan: "pro" | "business") =>
      apiFetch<{ ok: boolean; url: string }>("/license/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ plan }),
      }),
    onSuccess: (res) => {
      if (res.url) window.location.href = res.url;
    },
  });

  const portalMutation = useMutation({
    mutationFn: () => apiFetch<{ ok: boolean; url: string }>("/license/billing/portal", { method: "POST" }),
    onSuccess: (res) => {
      if (res.url) window.location.href = res.url;
    },
  });

  useEffect(() => {
    if (billingResult === "success" && data?.license.cloudConnected && !syncMutation.isPending) {
      syncMutation.mutate();
    }
  }, [billingResult, data?.license.cloudConnected]);

  const currentPlan = data?.license.plan ?? "free";
  const billingEnabled = billingPlans?.enabled ?? data?.license.billing?.enabled ?? false;

  return (
    <AppShell title="Plano e uso">
      <div className="mx-auto max-w-4xl space-y-6">
        {billingResult === "success" ? (
          <p className="rounded-card border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-ink">
            Pagamento recebido. Sincronizando licença…
          </p>
        ) : null}
        {billingResult === "cancel" ? (
          <p className="rounded-card border border-white/80 bg-white/70 px-4 py-3 text-sm text-muted">
            Checkout cancelado. Nenhuma alteração foi feita.
          </p>
        ) : null}

        {isLoading ? (
          <p className="text-sm text-muted">Carregando licença…</p>
        ) : error ? (
          <p className="rounded-card bg-danger/10 px-4 py-3 text-sm text-danger">Não foi possível carregar o plano.</p>
        ) : data ? (
          <>
            <section className="glass-card p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-accent">Plano atual</p>
                  <h2 className="mt-1 text-2xl font-bold capitalize text-ink">{data.license.plan}</h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  {data.license.cloudConnected ? (
                    <button
                      type="button"
                      disabled={syncMutation.isPending}
                      onClick={() => syncMutation.mutate()}
                      className="inline-flex items-center gap-1.5 rounded-card border border-white/80 bg-white/80 px-3 py-2 text-xs font-medium text-ink hover:bg-white disabled:opacity-50"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${syncMutation.isPending ? "animate-spin" : ""}`} />
                      Sincronizar licença
                    </button>
                  ) : null}
                  {billingEnabled && data.license.billing?.managedByStripe ? (
                    <button
                      type="button"
                      disabled={portalMutation.isPending}
                      onClick={() => portalMutation.mutate()}
                      className="inline-flex items-center gap-1.5 rounded-card bg-accent px-3 py-2 text-xs font-medium text-white hover:opacity-95 disabled:opacity-50"
                    >
                      <CreditCard className="h-3.5 w-3.5" />
                      Gerenciar assinatura
                    </button>
                  ) : null}
                </div>
              </div>
              <p className="mt-2 text-sm text-muted">
                Status: <span className="font-medium text-ink">{data.license.status}</span>
                {data.license.validUntil ? (
                  <> · válido até {new Date(data.license.validUntil).toLocaleDateString("pt-BR")}</>
                ) : null}
              </p>
              {data.license.billing?.currentPeriodEnd ? (
                <p className="mt-1 text-xs text-muted">
                  Próxima cobrança: {new Date(data.license.billing.currentPeriodEnd).toLocaleDateString("pt-BR")}
                  {data.license.billing.cancelAtPeriodEnd ? " (cancelamento agendado)" : null}
                </p>
              ) : null}
              {data.license.lastSyncAt ? (
                <p className="mt-1 text-xs text-muted">
                  Última sync: {new Date(data.license.lastSyncAt).toLocaleString("pt-BR")}
                </p>
              ) : null}
              {data.license.lastSyncError ? (
                <p className="mt-2 text-xs text-warning">Sync: {data.license.lastSyncError}</p>
              ) : null}
              <p className="mt-1 font-mono text-[11px] text-muted">Instância: {data.license.instanceId}</p>
            </section>

            {billingPlans?.plans?.length ? (
              <section className="space-y-3">
                <div>
                  <h3 className="font-semibold text-ink">Planos disponíveis</h3>
                  <p className="text-sm text-muted">
                    {billingEnabled
                      ? "Upgrade via Stripe. Após o pagamento, a licença é atualizada automaticamente."
                      : "Configure Stripe no License Cloud para habilitar checkout."}
                  </p>
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  {billingPlans.plans.map((plan) => {
                    const isCurrent = plan.id === currentPlan;
                    const canUpgrade =
                      billingEnabled &&
                      plan.upgradable &&
                      !isCurrent &&
                      (plan.id === "pro" || plan.id === "business") &&
                      (currentPlan === "free" || (currentPlan === "pro" && plan.id === "business"));
                    return (
                      <div
                        key={plan.id}
                        className={cn(
                          "glass-card flex flex-col p-5",
                          isCurrent && "ring-2 ring-accent/40",
                        )}
                      >
                        <p className="text-xs font-semibold uppercase tracking-widest text-accent">{plan.name}</p>
                        <p className="mt-2 text-2xl font-bold text-ink">{formatPrice(plan)}</p>
                        {plan.priceMonthly ? <p className="text-xs text-muted">por mês</p> : null}
                        <p className="mt-2 text-sm text-muted">{plan.description}</p>
                        <ul className="mt-4 flex-1 space-y-2">
                          {plan.features.map((feature) => (
                            <li key={feature} className="flex items-start gap-2 text-sm text-ink">
                              <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                              {feature}
                            </li>
                          ))}
                        </ul>
                        <div className="mt-5">
                          {isCurrent ? (
                            <span className="inline-flex w-full items-center justify-center rounded-card border border-accent/30 bg-accent/10 px-3 py-2 text-sm font-medium text-accent">
                              Plano atual
                            </span>
                          ) : canUpgrade ? (
                            <button
                              type="button"
                              disabled={checkoutMutation.isPending}
                              onClick={() => checkoutMutation.mutate(plan.id as "pro" | "business")}
                              className="inline-flex w-full items-center justify-center gap-1.5 rounded-card bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-95 disabled:opacity-60"
                            >
                              <ExternalLink className="h-4 w-4" />
                              {checkoutMutation.isPending ? "Redirecionando…" : `Upgrade ${plan.name}`}
                            </button>
                          ) : (
                            <span className="inline-flex w-full items-center justify-center rounded-card border px-3 py-2 text-sm text-muted">
                              {billingEnabled ? "Indisponível" : "Stripe off"}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {checkoutMutation.error ? (
                  <p className="text-sm text-danger">{(checkoutMutation.error as Error).message}</p>
                ) : null}
                {portalMutation.error ? (
                  <p className="text-sm text-danger">{(portalMutation.error as Error).message}</p>
                ) : null}
              </section>
            ) : null}

            <section className="glass-card space-y-4 p-6">
              <h3 className="font-semibold text-ink">Uso vs limites</h3>
              <UsageBar label="Servidores" used={data.usage.usage.servers ?? 0} limit={data.usage.limits.servers} />
              <UsageBar label="Sites" used={data.usage.usage.sites ?? 0} limit={data.usage.limits.sites} />
              <UsageBar label="Jobs (mês)" used={data.usage.usage.jobs_month ?? 0} limit={data.usage.limits.jobs_month} />
              <UsageBar label="API keys" used={data.usage.usage.api_keys ?? 0} limit={data.usage.limits.api_keys} />
              <UsageBar label="Membros" used={data.usage.usage.members ?? 0} limit={data.usage.limits.members} />
            </section>

            <section className="glass-card p-6 text-sm text-muted">
              <p>
                Com License Cloud configurado (`LICENSE_SERVER_URL`), a instância envia heartbeat automático a cada 6 horas
                com métricas de uso.
              </p>
              {!data.license.licenseKeyConfigured ? (
                <p className="mt-3 text-warning">Nenhuma LICENSE_KEY no `.env` da API.</p>
              ) : null}
            </section>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
