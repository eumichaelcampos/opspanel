"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Bell, Loader2, Plus, RefreshCw, Send, Trash2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AutomationSubNav } from "@/components/automation-sub-nav";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { AlertChannelType, AlertsHubResponse } from "@opspanel/contracts";

export default function AlertsPage() {
  const qc = useQueryClient();
  const [name, setName] = useState("Slack ops");
  const [type, setType] = useState<AlertChannelType>("slack");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [emailTo, setEmailTo] = useState("");

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["alerts-hub"],
    queryFn: () => apiFetch<AlertsHubResponse>("/alerts"),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      apiFetch("/alerts/channels", {
        method: "POST",
        body: JSON.stringify({
          name,
          type,
          webhookUrl: type === "email" ? undefined : webhookUrl || undefined,
          emailTo: type === "email" ? emailTo || undefined : undefined,
          enabled: true,
        }),
      }),
    onSuccess: () => {
      setWebhookUrl("");
      setEmailTo("");
      void qc.invalidateQueries({ queryKey: ["alerts-hub"] });
    },
  });

  const testMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/alerts/channels/${id}/test`, { method: "POST" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["alerts-hub"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/alerts/channels/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["alerts-hub"] }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      apiFetch(`/alerts/channels/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["alerts-hub"] }),
  });

  return (
    <AppShell title="Automação">
      <AutomationSubNav />
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">Alertas</h1>
            <p className="mt-1 text-sm text-muted">
              Canais Slack/webhook (e e-mail registrado) para falhas de job e eventos críticos.
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void refetch()}
            disabled={isLoading || isFetching}
          >
            <RefreshCw className={cn("h-4 w-4", (isLoading || isFetching) && "animate-spin")} />
            Atualizar
          </button>
        </div>

        <section className="glass-card space-y-4 p-5">
          <h2 className="flex items-center gap-2 font-semibold text-ink">
            <Plus className="h-4 w-4" />
            Novo canal
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-muted">Nome</span>
              <input
                className="mt-1 w-full rounded-lg border border-ink/15 bg-surface px-3 py-2 text-ink dark:border-white/15"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="text-muted">Tipo</span>
              <select
                className="mt-1 w-full rounded-lg border border-ink/15 bg-surface px-3 py-2 text-ink dark:border-white/15"
                value={type}
                onChange={(e) => setType(e.target.value as AlertChannelType)}
              >
                <option value="slack">Slack</option>
                <option value="webhook">Webhook</option>
                <option value="email">E-mail</option>
              </select>
            </label>
            {type === "email" ? (
              <label className="block text-sm sm:col-span-2">
                <span className="text-muted">E-mail destinário</span>
                <input
                  type="email"
                  className="mt-1 w-full rounded-lg border border-ink/15 bg-surface px-3 py-2 text-ink dark:border-white/15"
                  value={emailTo}
                  onChange={(e) => setEmailTo(e.target.value)}
                  placeholder="ops@empresa.com"
                />
              </label>
            ) : (
              <label className="block text-sm sm:col-span-2">
                <span className="text-muted">URL do webhook</span>
                <input
                  className="mt-1 w-full rounded-lg border border-ink/15 bg-surface px-3 py-2 text-ink dark:border-white/15"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  placeholder="https://hooks.slack.com/services/…"
                />
              </label>
            )}
          </div>
          <button
            type="button"
            className="btn-primary"
            disabled={createMutation.isPending || !name}
            onClick={() => createMutation.mutate()}
          >
            <Bell className="h-4 w-4" />
            Adicionar canal
          </button>
          {createMutation.isError ? (
            <p className="text-xs text-danger">
              {(createMutation.error as Error)?.message ?? "Falha ao criar canal."}
            </p>
          ) : null}
        </section>

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando alertas…
          </div>
        ) : (
          <>
            <section className="glass-card p-5">
              <h2 className="font-semibold text-ink">Canais</h2>
              <div className="mt-3 space-y-3">
                {(data?.channels ?? []).map((ch) => (
                  <div
                    key={ch.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-ink/10 p-3 dark:border-white/10"
                  >
                    <div>
                      <p className="font-medium text-ink">
                        {ch.name}{" "}
                        <span className="text-xs font-normal text-muted">({ch.type})</span>
                      </p>
                      <p className="text-xs text-muted">
                        {ch.type === "email" ? ch.emailTo : ch.webhookUrl}
                        {!ch.enabled ? " · desativado" : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => toggleMutation.mutate({ id: ch.id, enabled: !ch.enabled })}
                      >
                        {ch.enabled ? "Desativar" : "Ativar"}
                      </button>
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        disabled={testMutation.isPending}
                        onClick={() => testMutation.mutate(ch.id)}
                      >
                        <Send className="h-3.5 w-3.5" />
                        Testar
                      </button>
                      <button
                        type="button"
                        className="btn-ghost btn-sm text-danger"
                        onClick={() => {
                          if (confirm(`Excluir canal "${ch.name}"?`)) deleteMutation.mutate(ch.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
                {!data?.channels.length ? (
                  <p className="text-sm text-muted">Nenhum canal configurado.</p>
                ) : null}
              </div>
            </section>

            <section className="glass-card p-5">
              <h2 className="font-semibold text-ink">Eventos recentes</h2>
              <ul className="mt-3 divide-y divide-ink/10 dark:divide-white/10">
                {(data?.recentEvents ?? []).map((ev) => (
                  <li key={ev.id} className="py-2.5 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium text-ink">{ev.title}</p>
                      <span
                        className={cn(
                          "text-xs",
                          ev.status === "sent"
                            ? "text-success"
                            : ev.status === "skipped"
                              ? "text-warning"
                              : "text-danger",
                        )}
                      >
                        {ev.status}
                      </span>
                    </div>
                    {ev.body ? <p className="text-xs text-muted">{ev.body}</p> : null}
                    {ev.errorMessage ? (
                      <p className="text-xs text-muted">{ev.errorMessage}</p>
                    ) : null}
                    <p className="text-[11px] text-muted">
                      {new Date(ev.createdAt).toLocaleString("pt-BR")} · {ev.kind}
                    </p>
                  </li>
                ))}
                {!data?.recentEvents.length ? (
                  <li className="py-3 text-sm text-muted">Nenhum evento ainda.</li>
                ) : null}
              </ul>
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
