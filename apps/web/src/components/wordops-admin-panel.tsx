"use client";

import { useState } from "react";
import { ExternalLink, KeyRound, LayoutDashboard, Loader2, RefreshCw } from "lucide-react";
import { SecretField } from "@/components/secret-field";
import { apiFetch } from "@/lib/api";

type WordOpsDashboard = {
  url?: string;
  username?: string;
  password?: string;
  capturedAt?: string;
};

type DashboardTools = {
  monitoring: { id: string; label: string; path: string; desc: string }[];
  database: { id: string; label: string; path: string; desc: string }[];
  cache: { id: string; label: string; path: string; desc: string }[];
  php: { id: string; label: string; path: string; desc: string }[];
};

function adminUrl(host: string, path = "/"): string {
  return `https://${host}:22222${path}`;
}

export function WordOpsAdminPanel({
  serverId,
  host,
  dashboard,
  tools,
  onJobStarted,
}: {
  serverId: string;
  host: string;
  dashboard?: WordOpsDashboard | null;
  tools?: DashboardTools;
  onJobStarted?: (jobId: string) => void;
}) {
  const [busy, setBusy] = useState<"reset" | "capture" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const panelUrl = dashboard?.url ?? adminUrl(host);
  const hasCredentials = Boolean(dashboard?.username && dashboard?.password);

  async function recoverAccess(mode: "reset" | "capture") {
    setError(null);
    setBusy(mode);
    try {
      const result = await apiFetch<{ jobId: string }>(`/servers/${serverId}/wordops/dashboard/recover`, {
        method: "POST",
        body: JSON.stringify({ mode }),
      });
      onJobStarted?.(result.jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha na recuperação");
    } finally {
      setBusy(null);
    }
  }

  const quickLinks = tools
    ? [...tools.monitoring.slice(0, 2), ...tools.database, ...tools.cache.slice(0, 1)]
    : [
        { id: "home", label: "Painel WordOps", path: "/", desc: "Dashboard principal" },
        { id: "pma", label: "phpMyAdmin", path: "/db/pma/", desc: "Banco de dados MySQL" },
        { id: "netdata", label: "Netdata", path: "/netdata/", desc: "Monitoramento" },
      ];

  return (
    <section className="glass-card space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <LayoutDashboard className="h-4 w-4 text-accent" />
          <div>
            <h2 className="text-sm font-semibold">Admin WordOps</h2>
            <p className="text-xs text-muted">
              Backend na porta <code className="text-[10px]">22222</code> (HTTP Auth)
            </p>
          </div>
        </div>
        <a
          href={panelUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-card border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20"
        >
          Abrir painel
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="sm:col-span-2">
          <dt className="text-muted">URL</dt>
          <dd>
            <a href={panelUrl} target="_blank" rel="noreferrer" className="font-mono text-xs text-accent hover:underline">
              {panelUrl}
            </a>
          </dd>
        </div>
        {dashboard?.username ? (
          <div>
            <dt className="text-muted">Usuário HTTP</dt>
            <dd className="font-mono text-xs">{dashboard.username}</dd>
          </div>
        ) : null}
        {dashboard?.password ? (
          <div>
            <dt className="mb-1 text-muted">Senha HTTP</dt>
            <dd>
              <SecretField value={dashboard.password} />
            </dd>
          </div>
        ) : null}
        {dashboard?.capturedAt ? (
          <div className="sm:col-span-2">
            <dt className="text-muted">Salvo em</dt>
            <dd className="text-xs">{new Date(dashboard.capturedAt).toLocaleString("pt-BR")}</dd>
          </div>
        ) : null}
      </dl>

      <div className="rounded-card border border-white/80 bg-white/50 px-3 py-3 text-sm">
        <p className="flex items-center gap-2 font-medium text-ink">
          <KeyRound className="h-4 w-4 text-accent" />
          Recuperar acesso ao admin
        </p>
        <p className="mt-1 text-xs text-muted">
          Segundo a{" "}
          <a
            href="https://docs.wordops.net/commands/secure/"
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            documentação WordOps
          </a>
          , use <code className="text-[10px]">wo secure --auth</code> para redefinir usuário e senha HTTP do backend.
          O OpsPanel executa isso via SSH, grava em <code className="text-[10px]">wordopsDashboard</code> no banco e
          exibe aqui.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void recoverAccess("reset")}
            className="inline-flex items-center gap-2 rounded-card bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {busy === "reset" ? <Loader2 className="h-3 w-3 animate-spin" /> : <KeyRound className="h-3 w-3" />}
            Recuperar acesso (nova senha)
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void recoverAccess("capture")}
            className="inline-flex items-center gap-2 rounded-card border border-white/80 bg-white px-3 py-1.5 text-xs text-muted hover:bg-white/90 disabled:opacity-50"
          >
            {busy === "capture" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Só capturar da instalação
          </button>
        </div>
        {!hasCredentials ? (
          <p className="mt-2 text-xs text-warning">
            Este servidor ainda não tem credenciais salvas. Use &quot;Recuperar acesso&quot; para gerar uma nova senha
            e desbloquear o login em :22222.
          </p>
        ) : (
          <p className="mt-2 text-xs text-muted">
            &quot;Recuperar acesso&quot; gera uma senha nova e substitui a anterior no servidor e no OpsPanel.
          </p>
        )}
        {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-muted">Atalhos do admin</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {quickLinks.map((tool) => (
            <a
              key={tool.id}
              href={adminUrl(host, tool.path)}
              target="_blank"
              rel="noreferrer"
              className="rounded-card border border-white/80 bg-white/90 px-3 py-2 hover:bg-white"
            >
              <p className="text-sm font-medium">{tool.label}</p>
              <p className="text-[10px] text-muted">{tool.desc}</p>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
