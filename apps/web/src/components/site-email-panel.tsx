"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { EmailHealthBadge } from "@/components/email-health-badge";
import { JobTracker } from "@/components/job-tracker";
import { Loader2, Mail, Plus, RefreshCw, Send, Trash2 } from "lucide-react";
import type { DnsAuthStatus, EmailHealthReport } from "@opspanel/contracts";

type MailboxRow = {
  id: string;
  email: string;
  localPart: string;
  displayName?: string | null;
  quotaMb: number;
  status: string;
  webmailUrl?: string | null;
  imapHost?: string | null;
  smtpHost?: string | null;
};

type SiteEmailResponse = {
  site: { id: string; domain: string };
  provider: {
    mailboxConfigured: boolean;
    deliveryConfigured: boolean;
  };
  quotas: {
    usage: { mailboxes: number; email_domains: number };
    limits: { mailboxes: number | null; email_domains: number | null };
  };
  emailDomain: {
    id: string;
    domain: string;
    status: string;
    webmailUrl?: string | null;
    errorMessage?: string | null;
    mailboxes: MailboxRow[];
    health?: EmailHealthReport;
    lastHealthAt?: string | null;
  } | null;
  smtp: {
    fromAddress: string;
    fromName?: string | null;
    wpConfigured: boolean;
  } | null;
};

export function SiteEmailPanel({ siteId }: { siteId: string }) {
  const qc = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const [localPart, setLocalPart] = useState("contato");
  const [displayName, setDisplayName] = useState("");
  const [smtpFrom, setSmtpFrom] = useState("");
  const [smtpFromName, setSmtpFromName] = useState("");
  const [testTo, setTestTo] = useState("");

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["site-email", siteId],
    queryFn: () => apiFetch<SiteEmailResponse>(`/sites/${siteId}/email`),
  });

  const healthMutation = useMutation({
    mutationFn: () => apiFetch<EmailHealthReport>(`/sites/${siteId}/email/health?refresh=1`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["site-email", siteId] }),
  });

  const activateMutation = useMutation({
    mutationFn: () => apiFetch<{ jobId: string | null }>(`/sites/${siteId}/email/domains`, { method: "POST" }),
    onSuccess: (r) => {
      if (r.jobId) setJobId(r.jobId);
      void qc.invalidateQueries({ queryKey: ["site-email", siteId] });
    },
  });

  const syncDnsMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ created: number; updated: number; health: EmailHealthReport }>(
        `/sites/${siteId}/email/domains/sync-dns`,
        { method: "POST" },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["site-email", siteId] }),
  });

  const createMailboxMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ jobId: string }>(`/sites/${siteId}/email/mailboxes`, {
        method: "POST",
        body: JSON.stringify({ localPart: localPart.trim(), displayName: displayName.trim() || undefined }),
      }),
    onSuccess: (r) => {
      setJobId(r.jobId);
      void qc.invalidateQueries({ queryKey: ["site-email", siteId] });
    },
  });

  const deleteMailboxMutation = useMutation({
    mutationFn: (mailboxId: string) =>
      apiFetch<{ jobId: string }>(`/sites/${siteId}/email/mailboxes/${mailboxId}`, { method: "DELETE" }),
    onSuccess: (r) => {
      setJobId(r.jobId);
      void qc.invalidateQueries({ queryKey: ["site-email", siteId] });
    },
  });

  const saveSmtpMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/sites/${siteId}/email/smtp`, {
        method: "PUT",
        body: JSON.stringify({ fromAddress: smtpFrom.trim(), fromName: smtpFromName.trim() || undefined }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["site-email", siteId] }),
  });

  const testSmtpMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/sites/${siteId}/email/smtp/test`, {
        method: "POST",
        body: JSON.stringify({ to: testTo.trim() }),
      }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando e-mail…
      </div>
    );
  }

  const domain = data?.site.domain ?? "";
  const health = data?.emailDomain?.health;
  const mailboxLimit = data?.quotas.limits.mailboxes ?? 0;
  const mailboxUsed = data?.quotas.usage.mailboxes ?? 0;
  const domainLimit = data?.quotas.limits.email_domains ?? 0;
  const domainUsed = data?.quotas.usage.email_domains ?? 0;
  const hasMailboxQuota = mailboxLimit === null || mailboxLimit > 0;
  const hasDomainQuota = domainLimit === null || domainLimit > 0;
  const mailboxQuotaLabel =
    mailboxLimit === null
      ? `${mailboxUsed} caixas (contrato ilimitado)`
      : mailboxLimit === 0
        ? "Nenhuma caixa contratada"
        : `${mailboxUsed} / ${mailboxLimit} caixas contratadas`;
  const domainQuotaLabel =
    domainLimit === null
      ? `${domainUsed} domínios (contrato ilimitado)`
      : domainLimit === 0
        ? "Nenhum domínio contratado"
        : `${domainUsed} / ${domainLimit} domínios contratados`;
  const canCreateMailbox =
    data?.quotas.limits.mailboxes === null ||
    (data?.quotas.limits.mailboxes !== undefined && mailboxUsed < data.quotas.limits.mailboxes);

  if (!data?.provider.mailboxConfigured) {
    return (
      <section className="glass-card space-y-3 p-5">
        <h3 className="font-semibold">E-mail externo</h3>
        <p className="text-sm text-muted">
          O administrador do painel ainda não configurou o provedor de e-mail (ATRIOMAIL_API_KEY no servidor).
        </p>
        {health ? (
          <div className="flex flex-wrap gap-2">
            <EmailHealthBadge label="SPF" status={health.spf} />
            <EmailHealthBadge label="DKIM" status={health.dkim} />
            <EmailHealthBadge label="DMARC" status={health.dmarc} />
            <EmailHealthBadge label="MX" status={health.mx} />
          </div>
        ) : (
          <button type="button" className="btn-secondary btn-sm" onClick={() => healthMutation.mutate()} disabled={healthMutation.isPending}>
            Verificar DNS público
          </button>
        )}
      </section>
    );
  }

  if (!data.emailDomain) {
    return (
      <section className="glass-card space-y-4 p-5">
        <div className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-accent" />
          <h3 className="font-semibold">Ativar e-mail para {domain}</h3>
        </div>
        <p className="text-sm text-muted">
          Caixas @{domain} hospedadas fora do seu VPS. Requer Cloudflare conectado para publicar MX/SPF automaticamente.
          E-mail é um add-on pago: as caixas são contratadas separadamente e vinculadas à sua licença.
        </p>
        <p className="text-xs text-muted">
          {mailboxQuotaLabel} · {domainQuotaLabel}
        </p>
        {!hasDomainQuota ? (
          <p className="rounded-card border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-ink">
            Nenhum domínio de e-mail contratado. Peça ao administrador do OpsPanel para incluir e-mail na sua licença.
          </p>
        ) : null}
        <button
          type="button"
          className="btn-primary"
          disabled={activateMutation.isPending || !hasDomainQuota}
          onClick={() => activateMutation.mutate()}
        >
          {activateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
          Ativar e-mail deste site
        </button>
        {jobId ? <JobTracker jobId={jobId} onComplete={() => { setJobId(null); void refetch(); }} /> : null}
      </section>
    );
  }

  const ed = data.emailDomain;

  return (
    <div className="space-y-4">
      {jobId ? <JobTracker jobId={jobId} onComplete={() => { setJobId(null); void refetch(); }} /> : null}

      <section className="glass-card space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Saúde do domínio</h3>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary btn-sm" onClick={() => healthMutation.mutate()} disabled={healthMutation.isPending}>
              <RefreshCw className="h-3.5 w-3.5" />
              Verificar
            </button>
            <button type="button" className="btn-primary btn-sm" onClick={() => syncDnsMutation.mutate()} disabled={syncDnsMutation.isPending}>
              Publicar DNS no Cloudflare
            </button>
          </div>
        </div>
        <p className="text-xs text-muted">
          Status: <span className="font-mono">{ed.status}</span>
          {ed.errorMessage ? ` · ${ed.errorMessage}` : null}
        </p>
        {health ? (
          <div className="flex flex-wrap gap-2">
            <EmailHealthBadge label="SPF" status={health.spf as DnsAuthStatus} />
            <EmailHealthBadge label="DKIM" status={health.dkim as DnsAuthStatus} />
            <EmailHealthBadge label="DMARC" status={health.dmarc as DnsAuthStatus} />
            <EmailHealthBadge label="MX" status={health.mx as DnsAuthStatus} />
          </div>
        ) : null}
        {health?.details.mxHosts?.length ? (
          <p className="text-xs text-muted">MX atual: {health.details.mxHosts.join(", ")}</p>
        ) : null}
      </section>

      <section className="glass-card space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Caixas de e-mail</h3>
          <span className="text-xs text-muted">{mailboxQuotaLabel}</span>
        </div>
        {!hasMailboxQuota ? (
          <p className="rounded-card border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-ink">
            Nenhuma caixa contratada nesta licença. Solicite a contratação ao administrador do OpsPanel.
          </p>
        ) : null}
        {ed.mailboxes.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma caixa criada ainda.</p>
        ) : (
          <ul className="divide-y divide-ink/10 rounded-card border border-ink/10">
            {ed.mailboxes.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <div>
                  <p className="font-mono font-medium">{m.email}</p>
                  {m.imapHost ? (
                    <p className="text-xs text-muted">
                      IMAP {m.imapHost} · SMTP {m.smtpHost ?? m.imapHost}
                    </p>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  {m.webmailUrl || ed.webmailUrl ? (
                    <a
                      href={m.webmailUrl || ed.webmailUrl || "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-secondary btn-sm"
                    >
                      Webmail
                    </a>
                  ) : null}
                  <button
                    type="button"
                    className="btn-danger btn-sm"
                    disabled={deleteMailboxMutation.isPending}
                    onClick={() => {
                      if (window.confirm(`Excluir ${m.email}?`)) deleteMailboxMutation.mutate(m.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Usuário</span>
            <div className="flex items-center gap-1">
              <input
                className="w-full rounded-card border border-ink/20 bg-white px-3 py-2 text-sm"
                value={localPart}
                onChange={(e) => setLocalPart(e.target.value)}
              />
              <span className="text-muted">@{domain}</span>
            </div>
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Nome exibido</span>
            <input
              className="w-full rounded-card border border-ink/20 bg-white px-3 py-2 text-sm"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </label>
        </div>
        <button
          type="button"
          className="btn-primary"
          disabled={!canCreateMailbox || createMailboxMutation.isPending || !localPart.trim()}
          onClick={() => createMailboxMutation.mutate()}
        >
          <Plus className="h-4 w-4" />
          Criar caixa
        </button>
      </section>

      {data.provider.deliveryConfigured ? (
        <section className="glass-card space-y-4 p-5">
          <h3 className="font-semibold">Envio WordPress (transacional)</h3>
          <p className="text-sm text-muted">
            Configure forms e WooCommerce via plugin WP Mail SMTP usando Resend. Não usa Postfix no servidor.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Remetente</span>
              <input
                className="w-full rounded-card border border-ink/20 bg-white px-3 py-2 text-sm"
                placeholder={`noreply@${domain}`}
                value={smtpFrom || data.smtp?.fromAddress || ""}
                onChange={(e) => setSmtpFrom(e.target.value)}
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Nome</span>
              <input
                className="w-full rounded-card border border-ink/20 bg-white px-3 py-2 text-sm"
                value={smtpFromName || data.smtp?.fromName || ""}
                onChange={(e) => setSmtpFromName(e.target.value)}
              />
            </label>
          </div>
          <button type="button" className="btn-secondary" disabled={saveSmtpMutation.isPending} onClick={() => saveSmtpMutation.mutate()}>
            Salvar remetente
          </button>
          <div className="flex flex-wrap items-end gap-2 border-t border-ink/10 pt-4">
            <label className="block flex-1 space-y-1 text-sm">
              <span className="font-medium">E-mail de teste</span>
              <input
                type="email"
                className="w-full rounded-card border border-ink/20 bg-white px-3 py-2 text-sm"
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn-primary"
              disabled={testSmtpMutation.isPending || !testTo.trim()}
              onClick={() => testSmtpMutation.mutate()}
            >
              <Send className="h-4 w-4" />
              Enviar teste
            </button>
          </div>
          {testSmtpMutation.isSuccess ? <p className="text-sm text-success">E-mail de teste enviado.</p> : null}
          <p className="text-xs text-muted">
            SMTP Resend: host <code>smtp.resend.com</code>, porta 587, TLS. Use a API key do painel apenas via Resend dashboard
            até integrarmos credencial por site.
          </p>
        </section>
      ) : null}
    </div>
  );
}
