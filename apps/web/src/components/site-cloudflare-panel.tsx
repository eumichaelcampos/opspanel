"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { Cloud, Loader2, Pencil, Plus, RefreshCw, Save, Trash2, X } from "lucide-react";

type CfOverview = {
  connected: boolean;
  site: { id: string; domain: string; serverHost: string };
  zone: {
    id: string;
    name: string;
    status: string;
    paused: boolean;
    plan: string | null;
    nameServers: string[];
  } | null;
  zoneError?: string | null;
  credentials?: { connected: boolean; hint?: string | null; mode?: string | null };
  optimizations?: { id: string; label: string }[];
};

type DnsRecord = {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
  proxiable?: boolean;
  ttl: number;
  priority?: number | null;
  locked?: boolean;
};

type PageRuleAction = { id: string; value?: unknown };

type PageRuleRow = {
  id: string;
  priority: number;
  status: string;
  url: string;
  targets?: { target: string; constraint: { operator: string; value: string } }[];
  actions: PageRuleAction[] | string[];
};

type PageRuleDraft = {
  url: string;
  status: "active" | "disabled";
  priority: number;
  mode: "settings" | "redirect";
  cacheLevel: string;
  securityLevel: string;
  ssl: string;
  alwaysHttps: boolean;
  disablePerformance: boolean;
  redirectCode: "301" | "302";
  redirectUrl: string;
  extraActions: PageRuleAction[];
};

const DNS_TYPES = ["A", "AAAA", "CNAME", "TXT", "MX", "NS", "SRV", "CAA"] as const;
const PROXYABLE = new Set(["A", "AAAA", "CNAME"]);
const MANAGED_ACTIONS = new Set([
  "cache_level",
  "security_level",
  "ssl",
  "always_use_https",
  "disable_performance",
  "forwarding_url",
]);

function emptyDraft(domain: string): PageRuleDraft {
  return {
    url: `*${domain}/*`,
    status: "active",
    priority: 1,
    mode: "settings",
    cacheLevel: "bypass",
    securityLevel: "",
    ssl: "",
    alwaysHttps: false,
    disablePerformance: false,
    redirectCode: "301",
    redirectUrl: "",
    extraActions: [],
  };
}

function asActions(actions: PageRuleRow["actions"]): PageRuleAction[] {
  return (actions ?? []).map((a) => (typeof a === "string" ? { id: a } : a));
}

function parseRule(rule: PageRuleRow, domain: string): PageRuleDraft {
  const actions = asActions(rule.actions);
  const forwarding = actions.find((a) => a.id === "forwarding_url")?.value as
    | { status_code?: number; url?: string }
    | undefined;
  const actionValue = (id: string) => {
    const found = actions.find((a) => a.id === id);
    if (!found) return "";
    return found.value == null ? "on" : String(found.value);
  };
  return {
    url: rule.url || `*${domain}/*`,
    status: rule.status === "disabled" ? "disabled" : "active",
    priority: rule.priority || 1,
    mode: forwarding ? "redirect" : "settings",
    cacheLevel: actionValue("cache_level"),
    securityLevel: actionValue("security_level"),
    ssl: actionValue("ssl"),
    alwaysHttps: actions.some((a) => a.id === "always_use_https"),
    disablePerformance: actions.some((a) => a.id === "disable_performance"),
    redirectCode: forwarding?.status_code === 302 ? "302" : "301",
    redirectUrl: forwarding?.url ?? "",
    extraActions: actions.filter((a) => !MANAGED_ACTIONS.has(a.id)),
  };
}

function buildActions(draft: PageRuleDraft): PageRuleAction[] {
  if (draft.mode === "redirect") {
    return [
      {
        id: "forwarding_url",
        value: { status_code: Number(draft.redirectCode), url: draft.redirectUrl.trim() },
      },
    ];
  }
  const actions: PageRuleAction[] = [];
  if (draft.cacheLevel) actions.push({ id: "cache_level", value: draft.cacheLevel });
  if (draft.securityLevel) actions.push({ id: "security_level", value: draft.securityLevel });
  if (draft.ssl) actions.push({ id: "ssl", value: draft.ssl });
  if (draft.alwaysHttps) actions.push({ id: "always_use_https" });
  if (draft.disablePerformance) actions.push({ id: "disable_performance" });
  actions.push(...draft.extraActions);
  return actions;
}

function actionSummary(actions: PageRuleRow["actions"]): string {
  const list = asActions(actions);
  if (!list.length) return "sem ações";
  return list
    .map((a) => {
      if (a.id === "forwarding_url") {
        const v = a.value as { status_code?: number; url?: string } | undefined;
        return `Redirect ${v?.status_code ?? ""} → ${v?.url ?? ""}`.trim();
      }
      if (a.value == null || a.value === "on") return a.id.replaceAll("_", " ");
      return `${a.id.replaceAll("_", " ")}: ${typeof a.value === "string" ? a.value : JSON.stringify(a.value)}`;
    })
    .join(" · ");
}

type DnsSavePayload = {
  type: string;
  name: string;
  content: string;
  proxied: boolean;
  ttl: number;
  priority?: number;
};

function DnsEditorRow({
  record,
  busy,
  onSave,
  onDelete,
}: {
  record: DnsRecord;
  busy: boolean;
  onSave: (payload: DnsSavePayload) => void;
  onDelete: () => void;
}) {
  const [type, setType] = useState(record.type);
  const [name, setName] = useState(record.name);
  const [content, setContent] = useState(record.content);
  const [proxied, setProxied] = useState(record.proxied);
  const [ttl, setTtl] = useState(record.ttl || 1);
  const [priority, setPriority] = useState(record.priority ?? 10);

  useEffect(() => {
    setType(record.type);
    setName(record.name);
    setContent(record.content);
    setProxied(record.proxied);
    setTtl(record.ttl || 1);
    setPriority(record.priority ?? 10);
  }, [record]);

  const dirty =
    type !== record.type ||
    name !== record.name ||
    content !== record.content ||
    proxied !== record.proxied ||
    ttl !== (record.ttl || 1) ||
    (type === "MX" && priority !== (record.priority ?? 10));

  const canProxy = PROXYABLE.has(type);

  return (
    <tr className="border-t border-ink/5 align-top">
      <td className="py-2 pr-2">
        <select
          className="w-[5.5rem] rounded-card border border-ink/20 bg-white px-1.5 py-1 text-xs"
          value={type}
          disabled={record.locked || busy}
          onChange={(e) => setType(e.target.value)}
        >
          {DNS_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </td>
      <td className="py-2 pr-2">
        <input
          className="w-full min-w-[8rem] rounded-card border border-ink/20 bg-white px-2 py-1 font-mono text-xs"
          value={name}
          disabled={record.locked || busy}
          onChange={(e) => setName(e.target.value)}
        />
      </td>
      <td className="py-2 pr-2">
        <input
          className="w-full min-w-[10rem] rounded-card border border-ink/20 bg-white px-2 py-1 font-mono text-xs"
          value={content}
          disabled={record.locked || busy}
          onChange={(e) => setContent(e.target.value)}
        />
      </td>
      <td className="py-2 pr-2">
        {type === "MX" ? (
          <input
            type="number"
            min={0}
            className="w-16 rounded-card border border-ink/20 bg-white px-2 py-1 text-xs"
            value={priority}
            disabled={record.locked || busy}
            onChange={(e) => setPriority(Number(e.target.value))}
            title="Prioridade MX"
          />
        ) : (
          <span className="text-xs text-muted">-</span>
        )}
      </td>
      <td className="py-2 pr-2">
        <input
          type="number"
          min={1}
          className="w-16 rounded-card border border-ink/20 bg-white px-2 py-1 text-xs"
          value={ttl}
          disabled={record.locked || busy}
          onChange={(e) => setTtl(Number(e.target.value))}
          title="TTL (1 = automático)"
        />
      </td>
      <td className="py-2 pr-2">
        {canProxy ? (
          <label className="flex items-center gap-1 text-xs text-muted">
            <input
              type="checkbox"
              checked={proxied}
              disabled={record.locked || busy}
              onChange={(e) => setProxied(e.target.checked)}
            />
            {proxied ? "Laranja" : "Cinza"}
          </label>
        ) : (
          <span className="text-xs text-muted">DNS only</span>
        )}
      </td>
      <td className="py-2 text-right">
        <div className="flex justify-end gap-1">
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={record.locked || busy || !dirty || !name.trim() || !content.trim()}
            onClick={() =>
              onSave({
                type,
                name: name.trim(),
                content: content.trim(),
                proxied: canProxy ? proxied : false,
                ttl: ttl || 1,
                priority: type === "MX" ? priority : undefined,
              })
            }
            title="Salvar alterações"
          >
            <Save className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="text-danger hover:opacity-80 disabled:opacity-40"
            title={record.locked ? "Registro bloqueado na Cloudflare" : "Excluir"}
            disabled={record.locked || busy}
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}

function PageRuleForm({
  draft,
  onChange,
  extraHint,
}: {
  draft: PageRuleDraft;
  onChange: (next: PageRuleDraft) => void;
  extraHint?: string;
}) {
  const set = (patch: Partial<PageRuleDraft>) => onChange({ ...draft, ...patch });
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="block space-y-1 text-sm sm:col-span-2">
        <span className="text-xs text-muted">URL (use * como curinga)</span>
        <input
          className="w-full rounded-card border border-ink/20 bg-white px-3 py-2 font-mono text-sm"
          value={draft.url}
          onChange={(e) => set({ url: e.target.value })}
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="text-xs text-muted">Status</span>
        <select
          className="w-full rounded-card border border-ink/20 bg-white px-3 py-2 text-sm"
          value={draft.status}
          onChange={(e) => set({ status: e.target.value as PageRuleDraft["status"] })}
        >
          <option value="active">Ativa</option>
          <option value="disabled">Desligada</option>
        </select>
      </label>
      <label className="block space-y-1 text-sm">
        <span className="text-xs text-muted">Prioridade</span>
        <input
          type="number"
          min={1}
          max={100}
          className="w-full rounded-card border border-ink/20 bg-white px-3 py-2 text-sm"
          value={draft.priority}
          onChange={(e) => set({ priority: Number(e.target.value) || 1 })}
        />
      </label>
      <label className="block space-y-1 text-sm sm:col-span-2">
        <span className="text-xs text-muted">Tipo de ação</span>
        <select
          className="w-full rounded-card border border-ink/20 bg-white px-3 py-2 text-sm"
          value={draft.mode}
          onChange={(e) => set({ mode: e.target.value as PageRuleDraft["mode"] })}
        >
          <option value="settings">Configurações (cache, SSL, segurança)</option>
          <option value="redirect">Redirecionar URL</option>
        </select>
      </label>
      {draft.mode === "redirect" ? (
        <>
          <label className="block space-y-1 text-sm">
            <span className="text-xs text-muted">Código</span>
            <select
              className="w-full rounded-card border border-ink/20 bg-white px-3 py-2 text-sm"
              value={draft.redirectCode}
              onChange={(e) => set({ redirectCode: e.target.value as "301" | "302" })}
            >
              <option value="301">301 permanente</option>
              <option value="302">302 temporário</option>
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-xs text-muted">Destino</span>
            <input
              className="w-full rounded-card border border-ink/20 bg-white px-3 py-2 font-mono text-sm"
              placeholder="https://..."
              value={draft.redirectUrl}
              onChange={(e) => set({ redirectUrl: e.target.value })}
            />
          </label>
        </>
      ) : (
        <>
          <label className="block space-y-1 text-sm">
            <span className="text-xs text-muted">Cache</span>
            <select
              className="w-full rounded-card border border-ink/20 bg-white px-3 py-2 text-sm"
              value={draft.cacheLevel}
              onChange={(e) => set({ cacheLevel: e.target.value })}
            >
              <option value="">Não alterar</option>
              <option value="bypass">Bypass (sem cache)</option>
              <option value="basic">Basic</option>
              <option value="simplified">Simplified</option>
              <option value="aggressive">Aggressive</option>
              <option value="cache_everything">Cache Everything</option>
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-xs text-muted">Segurança</span>
            <select
              className="w-full rounded-card border border-ink/20 bg-white px-3 py-2 text-sm"
              value={draft.securityLevel}
              onChange={(e) => set({ securityLevel: e.target.value })}
            >
              <option value="">Não alterar</option>
              <option value="essentially_off">Essentially Off</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="under_attack">I am Under Attack</option>
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-xs text-muted">SSL</span>
            <select
              className="w-full rounded-card border border-ink/20 bg-white px-3 py-2 text-sm"
              value={draft.ssl}
              onChange={(e) => set({ ssl: e.target.value })}
            >
              <option value="">Não alterar</option>
              <option value="off">Off</option>
              <option value="flexible">Flexible</option>
              <option value="full">Full</option>
              <option value="strict">Full (strict)</option>
            </select>
          </label>
          <div className="flex flex-col justify-end gap-2 text-sm">
            <label className="flex items-center gap-2 text-muted">
              <input
                type="checkbox"
                checked={draft.alwaysHttps}
                onChange={(e) => set({ alwaysHttps: e.target.checked })}
              />
              Sempre HTTPS
            </label>
            <label className="flex items-center gap-2 text-muted">
              <input
                type="checkbox"
                checked={draft.disablePerformance}
                onChange={(e) => set({ disablePerformance: e.target.checked })}
              />
              Desligar performance (Apps/Rocket)
            </label>
          </div>
        </>
      )}
      {extraHint ? <p className="text-xs text-muted sm:col-span-2">{extraHint}</p> : null}
    </div>
  );
}

export function SiteCloudflarePanel({ siteId }: { siteId: string }) {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const [dnsForm, setDnsForm] = useState({
    type: "A",
    name: "",
    content: "",
    proxied: true,
    ttl: 1,
    priority: 10,
  });
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [ruleDraft, setRuleDraft] = useState<PageRuleDraft | null>(null);
  const [creatingRule, setCreatingRule] = useState(false);
  const [newRule, setNewRule] = useState<PageRuleDraft | null>(null);

  const overview = useQuery({
    queryKey: ["site-cf", siteId],
    queryFn: () => apiFetch<CfOverview>(`/sites/${siteId}/cloudflare`),
  });

  const connected = Boolean(overview.data?.connected);
  const hasZone = Boolean(overview.data?.zone);
  const domain = overview.data?.site.domain ?? "";

  const dns = useQuery({
    queryKey: ["site-cf-dns", siteId],
    queryFn: () => apiFetch<{ records: DnsRecord[] }>(`/sites/${siteId}/cloudflare/dns`),
    enabled: connected && hasZone,
  });

  const rules = useQuery({
    queryKey: ["site-cf-rules", siteId],
    queryFn: () => apiFetch<{ rules: PageRuleRow[] }>(`/sites/${siteId}/cloudflare/page-rules`),
    enabled: connected && hasZone,
  });

  const invalidateAll = () => {
    void qc.invalidateQueries({ queryKey: ["site-cf", siteId] });
    void qc.invalidateQueries({ queryKey: ["site-cf-dns", siteId] });
    void qc.invalidateQueries({ queryKey: ["site-cf-rules", siteId] });
    void qc.invalidateQueries({ queryKey: ["site-dns", siteId] });
  };

  const pointServer = useMutation({
    mutationFn: () =>
      apiFetch<{ serverIp: string; results: { name: string; action: string }[] }>(
        `/sites/${siteId}/cloudflare/dns/point-server`,
        { method: "POST", body: JSON.stringify({ proxied: true, includeWww: true }) },
      ),
    onSuccess: (r) => {
      setMsg(`DNS apontado para ${r.serverIp}: ${r.results.map((x) => `${x.name} (${x.action})`).join(", ")}`);
      invalidateAll();
    },
    onError: (e) => setMsg(e instanceof Error ? e.message : "Falha ao apontar DNS"),
  });

  const optimize = useMutation({
    mutationFn: () =>
      apiFetch<{ summary: string; applied: { label: string; ok: boolean; error?: string }[] }>(
        `/sites/${siteId}/cloudflare/optimize`,
        { method: "POST", body: "{}" },
      ),
    onSuccess: (r) => {
      const fails = r.applied.filter((a) => !a.ok);
      setMsg(fails.length ? `${r.summary}. Falhas: ${fails.map((f) => f.label).join(", ")}` : r.summary);
      invalidateAll();
    },
    onError: (e) => setMsg(e instanceof Error ? e.message : "Falha ao otimizar"),
  });

  const wpRules = useMutation({
    mutationFn: () =>
      apiFetch<{ rules: { key: string; skipped?: boolean }[] }>(
        `/sites/${siteId}/cloudflare/page-rules/wordpress`,
        { method: "POST", body: "{}" },
      ),
    onSuccess: (r) => {
      setMsg(`Page rules WP: ${r.rules.map((x) => `${x.key}${x.skipped ? " (já existia)" : ""}`).join(", ")}`);
      invalidateAll();
    },
    onError: (e) => setMsg(e instanceof Error ? e.message : "Falha nas page rules"),
  });

  const createDns = useMutation({
    mutationFn: () =>
      apiFetch(`/sites/${siteId}/cloudflare/dns`, {
        method: "POST",
        body: JSON.stringify({
          type: dnsForm.type,
          name: dnsForm.name.trim() || "@",
          content: dnsForm.content.trim(),
          ttl: dnsForm.ttl || 1,
          priority: dnsForm.type === "MX" ? dnsForm.priority : undefined,
          proxied:
            dnsForm.type === "A" || dnsForm.type === "AAAA" || dnsForm.type === "CNAME" ? dnsForm.proxied : false,
        }),
      }),
    onSuccess: () => {
      setDnsForm((s) => ({ ...s, name: "", content: "" }));
      setMsg("Registro DNS criado.");
      invalidateAll();
    },
    onError: (e) => setMsg(e instanceof Error ? e.message : "Falha ao criar DNS"),
  });

  const updateDns = useMutation({
    mutationFn: (input: DnsSavePayload & { recordId: string }) =>
      apiFetch(`/sites/${siteId}/cloudflare/dns/${input.recordId}`, {
        method: "PATCH",
        body: JSON.stringify({
          type: input.type,
          name: input.name,
          content: input.content,
          proxied: input.proxied,
          ttl: input.ttl,
          priority: input.priority,
        }),
      }),
    onSuccess: () => {
      setMsg("Registro DNS atualizado.");
      invalidateAll();
    },
    onError: (e) => setMsg(e instanceof Error ? e.message : "Falha ao atualizar DNS"),
  });

  const deleteDns = useMutation({
    mutationFn: (recordId: string) =>
      apiFetch(`/sites/${siteId}/cloudflare/dns/${recordId}`, { method: "DELETE" }),
    onSuccess: () => {
      setMsg("Registro removido.");
      invalidateAll();
    },
    onError: (e) => setMsg(e instanceof Error ? e.message : "Falha ao remover"),
  });

  const saveRule = useMutation({
    mutationFn: (input: { ruleId?: string; draft: PageRuleDraft }) => {
      const actions = buildActions(input.draft);
      if (!actions.length) throw new Error("Inclua pelo menos uma ação na page rule.");
      if (input.draft.mode === "redirect" && !input.draft.redirectUrl.trim()) {
        throw new Error("Informe a URL de destino do redirecionamento.");
      }
      const body = JSON.stringify({
        url: input.draft.url.trim(),
        status: input.draft.status,
        priority: input.draft.priority,
        actions,
      });
      return input.ruleId
        ? apiFetch(`/sites/${siteId}/cloudflare/page-rules/${input.ruleId}`, { method: "PATCH", body })
        : apiFetch(`/sites/${siteId}/cloudflare/page-rules`, { method: "POST", body });
    },
    onSuccess: (_r, input) => {
      setMsg(input.ruleId ? "Page rule atualizada." : "Page rule criada.");
      setEditingRuleId(null);
      setRuleDraft(null);
      setCreatingRule(false);
      setNewRule(null);
      invalidateAll();
    },
    onError: (e) => setMsg(e instanceof Error ? e.message : "Falha ao salvar page rule"),
  });

  const deleteRule = useMutation({
    mutationFn: (ruleId: string) =>
      apiFetch(`/sites/${siteId}/cloudflare/page-rules/${ruleId}`, { method: "DELETE" }),
    onSuccess: () => {
      setMsg("Page rule removida.");
      setEditingRuleId(null);
      invalidateAll();
    },
    onError: (e) => setMsg(e instanceof Error ? e.message : "Falha ao remover rule"),
  });

  const records = useMemo(() => dns.data?.records ?? [], [dns.data]);
  const pageRules = useMemo(() => rules.data?.rules ?? [], [rules.data]);

  if (overview.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando Cloudflare…
      </div>
    );
  }

  if (overview.isError || !overview.data) {
    return (
      <div className="rounded-card border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
        Não foi possível carregar o painel Cloudflare.
        <button type="button" className="btn-secondary btn-sm ml-2" onClick={() => void overview.refetch()}>
          Tentar de novo
        </button>
      </div>
    );
  }

  const data = overview.data;

  if (!data.connected) {
    return (
      <div className="space-y-4">
        <div className="rounded-card border border-ink/10 bg-white/70 p-5">
          <div className="flex items-center gap-2">
            <Cloud className="h-5 w-5 text-accent" />
            <h3 className="font-semibold">Cloudflare</h3>
          </div>
          <p className="mt-2 text-sm text-muted">
            Conecte sua conta Cloudflare uma vez em Conta → Integrações. Depois você gerencia DNS, otimizações e
            page rules daqui, sem abrir o painel da Cloudflare.
          </p>
          <Link href="/settings/account" className="btn-primary mt-4 inline-flex">
            Conectar Cloudflare
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Cloud className="h-5 w-5 text-accent" />
            <h3 className="font-semibold">Cloudflare</h3>
          </div>
          <p className="mt-1 text-sm text-muted">
            Conta: <span className="font-mono text-xs">{data.credentials?.hint ?? "conectada"}</span>
            {data.zone ? (
              <>
                {" "}
                · Zona <strong>{data.zone.name}</strong> ({data.zone.status}
                {data.zone.plan ? ` · ${data.zone.plan}` : ""})
              </>
            ) : null}
          </p>
        </div>
        <button type="button" className="btn-secondary btn-sm" onClick={() => invalidateAll()}>
          <RefreshCw className="h-3.5 w-3.5" />
          Atualizar
        </button>
      </div>

      {msg ? <p className="rounded-card bg-ink/5 px-3 py-2 text-sm text-ink">{msg}</p> : null}

      {!data.zone ? (
        <div className="rounded-card border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
          <p className="font-medium">Zona não encontrada</p>
          <p className="mt-1 text-muted">
            {data.zoneError ??
              `O domínio ${data.site.domain} não aparece na conta Cloudflare conectada. Adicione o site na Cloudflare ou use outra conta.`}
          </p>
          <Link href="/settings/account" className="btn-secondary btn-sm mt-3 inline-flex">
            Trocar conta Cloudflare
          </Link>
        </div>
      ) : (
        <>
          <section className="rounded-card border border-ink/10 bg-white/70 p-4 space-y-3">
            <h4 className="text-sm font-semibold">Ações rápidas</h4>
            <p className="text-xs text-muted">
              Servidor alvo: <span className="font-mono">{data.site.serverHost}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-primary btn-sm"
                disabled={pointServer.isPending}
                onClick={() => pointServer.mutate()}
              >
                {pointServer.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Apontar DNS para este servidor
              </button>
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={optimize.isPending}
                onClick={() => {
                  if (window.confirm("Aplicar otimizações padrão (SSL Full, HTTPS, Brotli, HTTP/3, etc.)?")) {
                    optimize.mutate();
                  }
                }}
              >
                {optimize.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Aplicar otimizações padrão
              </button>
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={wpRules.isPending}
                onClick={() => wpRules.mutate()}
              >
                {wpRules.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Page rules WordPress
              </button>
            </div>
            {data.optimizations?.length ? (
              <ul className="mt-2 grid gap-1 text-xs text-muted sm:grid-cols-2">
                {data.optimizations.map((o) => (
                  <li key={o.id}>· {o.label}</li>
                ))}
              </ul>
            ) : null}
            {data.zone.nameServers.length ? (
              <p className="text-xs text-muted">Nameservers: {data.zone.nameServers.join(", ")}</p>
            ) : null}
          </section>

          <section className="rounded-card border border-ink/10 bg-white/70 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold">Apontamentos DNS</h4>
              <p className="text-xs text-muted">{records.length} registro(s) na zona {data.zone.name}</p>
            </div>
            {dns.isLoading ? (
              <p className="flex items-center gap-2 text-sm text-muted">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando apontamentos da Cloudflare…
              </p>
            ) : dns.isError ? (
              <div className="rounded-card border border-danger/30 bg-danger/5 px-3 py-2 text-sm">
                <p className="text-danger">Não foi possível listar os registros DNS.</p>
                <p className="mt-1 text-xs text-muted">{(dns.error as Error).message}</p>
                <button type="button" className="btn-secondary btn-sm mt-2" onClick={() => void dns.refetch()}>
                  Tentar novamente
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="text-xs text-muted">
                    <tr>
                      <th className="py-1 pr-2 font-medium">Tipo</th>
                      <th className="py-1 pr-2 font-medium">Nome</th>
                      <th className="py-1 pr-2 font-medium">Conteúdo / destino</th>
                      <th className="py-1 pr-2 font-medium">Prio</th>
                      <th className="py-1 pr-2 font-medium">TTL</th>
                      <th className="py-1 pr-2 font-medium">Proxy</th>
                      <th className="py-1 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((r) => (
                      <DnsEditorRow
                        key={r.id}
                        record={r}
                        busy={updateDns.isPending || deleteDns.isPending}
                        onSave={(payload) => updateDns.mutate({ recordId: r.id, ...payload })}
                        onDelete={() => {
                          if (window.confirm(`Excluir ${r.type} ${r.name}?`)) deleteDns.mutate(r.id);
                        }}
                      />
                    ))}
                  </tbody>
                </table>
                {!records.length ? (
                  <p className="py-3 text-sm text-muted">Nenhum apontamento nesta zona ainda.</p>
                ) : null}
              </div>
            )}

            <div className="grid gap-2 border-t border-ink/5 pt-3 sm:grid-cols-6">
              <select
                className="rounded-card border border-ink/20 bg-white px-2 py-2 text-sm"
                value={dnsForm.type}
                onChange={(e) => setDnsForm((s) => ({ ...s, type: e.target.value }))}
              >
                {DNS_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <input
                className="rounded-card border border-ink/20 bg-white px-2 py-2 text-sm"
                placeholder="nome (@ ou www)"
                value={dnsForm.name}
                onChange={(e) => setDnsForm((s) => ({ ...s, name: e.target.value }))}
              />
              <input
                className="rounded-card border border-ink/20 bg-white px-2 py-2 text-sm sm:col-span-2"
                placeholder="conteúdo / IP / destino"
                value={dnsForm.content}
                onChange={(e) => setDnsForm((s) => ({ ...s, content: e.target.value }))}
              />
              {dnsForm.type === "MX" ? (
                <input
                  type="number"
                  min={0}
                  className="rounded-card border border-ink/20 bg-white px-2 py-2 text-sm"
                  placeholder="prio"
                  value={dnsForm.priority}
                  onChange={(e) => setDnsForm((s) => ({ ...s, priority: Number(e.target.value) }))}
                />
              ) : (
                <input
                  type="number"
                  min={1}
                  className="rounded-card border border-ink/20 bg-white px-2 py-2 text-sm"
                  placeholder="TTL"
                  value={dnsForm.ttl}
                  onChange={(e) => setDnsForm((s) => ({ ...s, ttl: Number(e.target.value) }))}
                />
              )}
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={!dnsForm.content.trim() || createDns.isPending}
                onClick={() => createDns.mutate()}
              >
                <Plus className="h-3.5 w-3.5" />
                Adicionar
              </button>
            </div>
            {(dnsForm.type === "A" || dnsForm.type === "AAAA" || dnsForm.type === "CNAME") && (
              <label className="flex items-center gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={dnsForm.proxied}
                  onChange={(e) => setDnsForm((s) => ({ ...s, proxied: e.target.checked }))}
                />
                Proxy Cloudflare (laranja)
              </label>
            )}
          </section>

          <section className="rounded-card border border-ink/10 bg-white/70 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold">Page rules</h4>
              <p className="text-xs text-muted">{pageRules.length} regra(s) na zona. Planos gratuitos têm limite baixo.</p>
            </div>
            {rules.isLoading ? (
              <p className="flex items-center gap-2 text-sm text-muted">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando page rules da Cloudflare…
              </p>
            ) : rules.isError ? (
              <div className="rounded-card border border-danger/30 bg-danger/5 px-3 py-2 text-sm">
                <p className="text-danger">Não foi possível listar as page rules.</p>
                <p className="mt-1 text-xs text-muted">{(rules.error as Error).message}</p>
                <button type="button" className="btn-secondary btn-sm mt-2" onClick={() => void rules.refetch()}>
                  Tentar novamente
                </button>
              </div>
            ) : (
              <ul className="space-y-3">
                {pageRules.map((r) => (
                    <li key={r.id} className="rounded-card bg-ink/5 px-3 py-3 text-sm">
                      {editingRuleId === r.id && ruleDraft ? (
                        <div className="space-y-3">
                          <PageRuleForm
                            draft={ruleDraft}
                            onChange={(next) => setRuleDraft(next)}
                            extraHint={
                              ruleDraft.extraActions.length
                                ? `Outras ações da Cloudflare serão mantidas: ${ruleDraft.extraActions.map((a) => a.id).join(", ")}`
                                : undefined
                            }
                          />
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="btn-primary btn-sm"
                              disabled={saveRule.isPending}
                              onClick={() => saveRule.mutate({ ruleId: r.id, draft: ruleDraft })}
                            >
                              {saveRule.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                              Salvar
                            </button>
                            <button
                              type="button"
                              className="btn-secondary btn-sm"
                              onClick={() => {
                                setEditingRuleId(null);
                                setRuleDraft(null);
                              }}
                            >
                              <X className="h-3.5 w-3.5" />
                              Cancelar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="break-all font-mono text-xs">{r.url || "(sem URL)"}</p>
                            <p className="mt-1 text-xs text-muted">
                              {r.status === "active" ? "Ativa" : "Desligada"} · prioridade {r.priority} ·{" "}
                              {actionSummary(r.actions)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className="btn-secondary btn-sm"
                              onClick={() => {
                                setCreatingRule(false);
                                setEditingRuleId(r.id);
                                setRuleDraft(parseRule(r, domain));
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Editar
                            </button>
                            <button
                              type="button"
                              className="text-danger"
                              disabled={deleteRule.isPending}
                              onClick={() => {
                                if (window.confirm("Excluir esta page rule?")) deleteRule.mutate(r.id);
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                ))}
                {!pageRules.length ? (
                  <p className="text-sm text-muted">Nenhuma page rule nesta zona ainda.</p>
                ) : null}
              </ul>
            )}

            {creatingRule && newRule ? (
              <div className="space-y-3 rounded-card border border-ink/10 bg-white px-3 py-3">
                <p className="text-sm font-medium">Nova page rule</p>
                <PageRuleForm draft={newRule} onChange={setNewRule} />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-primary btn-sm"
                    disabled={saveRule.isPending}
                    onClick={() => saveRule.mutate({ draft: newRule })}
                  >
                    {saveRule.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                    Criar regra
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => {
                      setCreatingRule(false);
                      setNewRule(null);
                    }}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => {
                  setEditingRuleId(null);
                  setRuleDraft(null);
                  setCreatingRule(true);
                  setNewRule(emptyDraft(domain));
                }}
              >
                <Plus className="h-3.5 w-3.5" />
                Nova page rule
              </button>
            )}
          </section>
        </>
      )}
    </div>
  );
}
