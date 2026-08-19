"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { Copy, Globe } from "lucide-react";

type InstanceSettings = {
  organization: { id: string; name: string; slug: string } | null;
  panelDomain?: string | null;
  panelUrl?: string | null;
  webUrl: string;
  apiUrl: string;
  serverIp?: string | null;
  canManage: boolean;
  googleDrive?: {
    configured: boolean;
    mode?: "hub" | "broker" | "local" | "none";
    brokerUrl?: string | null;
    clientId?: string | null;
    fromEnv?: boolean;
    redirectUri: string;
  };
};

type DomainApplyResult = {
  ok: boolean;
  panelDomain?: string;
  panelUrl?: string;
  serverIp?: string;
  dns?: { hint: string; records: { type: string; name: string; value: string }[] };
  nginxSnippet?: string;
  nextSteps?: string[];
  restartRequired?: boolean;
  message?: string;
};

export default function InstanceSettingsPage() {
  const qc = useQueryClient();
  const [orgName, setOrgName] = useState("");
  const [panelDomain, setPanelDomain] = useState("");
  const [googleClientId, setGoogleClientId] = useState("");
  const [googleClientSecret, setGoogleClientSecret] = useState("");
  const [useHttps, setUseHttps] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<DomainApplyResult | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["settings-instance"],
    queryFn: () => apiFetch<InstanceSettings>("/settings/instance"),
  });

  useEffect(() => {
    if (!data) return;
    setOrgName(data.organization?.name ?? "");
    setPanelDomain(data.panelDomain ?? "");
    setGoogleClientId(data.googleDrive?.clientId ?? "");
  }, [data]);

  const saveOrg = useMutation({
    mutationFn: () =>
      apiFetch<InstanceSettings>("/settings/instance", {
        method: "PATCH",
        body: JSON.stringify({ organizationName: orgName.trim() }),
      }),
    onSuccess: () => {
      setMsg("Nome da empresa atualizado.");
      void qc.invalidateQueries({ queryKey: ["settings-instance"] });
    },
    onError: (e) => setMsg(e instanceof Error ? e.message : "Falha ao salvar"),
  });

  const saveGoogle = useMutation({
    mutationFn: () =>
      apiFetch<InstanceSettings>("/settings/instance", {
        method: "PATCH",
        body: JSON.stringify({
          googleDriveClientId: googleClientId.trim() || null,
          googleDriveClientSecret: googleClientSecret.trim() || undefined,
        }),
      }),
    onSuccess: () => {
      setGoogleClientSecret("");
      setMsg("Credenciais do Google Drive salvas. Agora conecte a conta em Conta e API.");
      void qc.invalidateQueries({ queryKey: ["settings-instance"] });
    },
    onError: (e) => setMsg(e instanceof Error ? e.message : "Falha ao salvar Google Drive"),
  });

  const applyDomain = useMutation({
    mutationFn: () =>
      apiFetch<DomainApplyResult>("/settings/instance/panel-domain", {
        method: "POST",
        body: JSON.stringify({
          domain: panelDomain.trim() || null,
          useHttps,
        }),
      }),
    onSuccess: (r) => {
      setApplyResult(r);
      setMsg(r.panelUrl ? `Painel configurado para ${r.panelUrl}` : r.message || "Atualizado.");
      void qc.invalidateQueries({ queryKey: ["settings-instance"] });
    },
    onError: (e) => setMsg(e instanceof Error ? e.message : "Falha ao aplicar domínio"),
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {isLoading ? <p className="text-sm text-muted">Carregando…</p> : null}

        <section className="glass-card space-y-4 p-5">
          <h2 className="font-semibold">Empresa / organização</h2>
          <p className="text-sm text-muted">
            Nome exibido no painel. Cada instalação é da sua empresa, sem dados de outros clientes.
          </p>
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">Nome</span>
            <input
              className="w-full rounded-card border border-ink/20 bg-white px-3 py-2 text-sm"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              disabled={!data?.canManage}
            />
          </label>
          <button
            type="button"
            className="btn-primary"
            disabled={!data?.canManage || orgName.trim().length < 2 || saveOrg.isPending}
            onClick={() => saveOrg.mutate()}
          >
            Salvar nome
          </button>
        </section>

        <section className="glass-card space-y-4 p-5">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-accent" />
            <h2 className="font-semibold">Domínio do painel</h2>
          </div>
          <p className="text-sm text-muted">
            Em vez de acessar por IP:3000, use um domínio seu (ex: painel.suaempresa.com). Aponte o DNS
            para este servidor e configure o Nginx.
          </p>
          <p className="text-xs text-muted">
            URL atual: <span className="font-mono">{data?.panelUrl ?? data?.webUrl}</span>
            {data?.serverIp ? (
              <>
                {" "}
                · IP detectado: <span className="font-mono">{data.serverIp}</span>
              </>
            ) : null}
          </p>
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">Domínio</span>
            <input
              className="w-full rounded-card border border-ink/20 bg-white px-3 py-2 text-sm"
              placeholder="painel.suaempresa.com"
              value={panelDomain}
              onChange={(e) => setPanelDomain(e.target.value)}
              disabled={!data?.canManage}
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={useHttps}
              onChange={(e) => setUseHttps(e.target.checked)}
              disabled={!data?.canManage}
            />
            Usar HTTPS
          </label>
          <button
            type="button"
            className="btn-primary"
            disabled={!data?.canManage || applyDomain.isPending}
            onClick={() => applyDomain.mutate()}
          >
            {applyDomain.isPending ? "Aplicando…" : "Salvar domínio do painel"}
          </button>

          {applyResult?.nextSteps?.length ? (
            <div className="rounded-card bg-ink/5 p-4 text-sm space-y-2">
              <p className="font-medium">Próximos passos</p>
              <ol className="list-decimal space-y-1 pl-4 text-muted">
                {applyResult.nextSteps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              {applyResult.dns?.hint ? <p className="text-xs text-muted">{applyResult.dns.hint}</p> : null}
              {applyResult.nginxSnippet ? (
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <p className="text-xs text-muted">Snippet Nginx</p>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-xs text-accent"
                      onClick={() => void navigator.clipboard.writeText(applyResult.nginxSnippet || "")}
                    >
                      <Copy className="h-3 w-3" /> Copiar
                    </button>
                  </div>
                  <pre className="overflow-x-auto rounded-card bg-white/80 p-3 text-xs">{applyResult.nginxSnippet}</pre>
                </div>
              ) : null}
              {applyResult.restartRequired ? (
                <p className="text-xs text-warning">Reinicie api/web no PM2 para aplicar WEB_URL.</p>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="glass-card space-y-4 p-5">
          <h2 className="font-semibold">Google Drive</h2>
          {data?.googleDrive?.mode === "broker" ? (
            <p className="text-sm text-muted">
              Esta instalação usa o OAuth central da OpsPanel em publisher.michaelcampos.com.br. Cada usuário
              conecta a própria conta em Configurações → Conta. Não é preciso criar um app no Google Cloud
              neste servidor.
            </p>
          ) : (
            <>
              <p className="text-sm text-muted">
                {data?.googleDrive?.mode === "hub"
                  ? "Este painel é o OAuth central. Cadastre um único Client Web no Google Cloud, com esta URI de retorno. Depois, cada usuário (neste e nos outros servidores) conecta a conta dele em Configurações → Conta."
                  : "Crie um OAuth Client do tipo Web no Google Cloud, ative a API do Drive e cole as credenciais aqui. URI de retorno:"}
              </p>
              <p className="break-all font-mono text-xs text-muted">{data?.googleDrive?.redirectUri}</p>
              {data?.googleDrive?.fromEnv ? (
                <p className="text-xs text-muted">Client ID/Secret já definidos no .env do servidor.</p>
              ) : null}
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">Client ID</span>
                <input
                  className="w-full rounded-card border border-ink/20 bg-white px-3 py-2 text-sm"
                  value={googleClientId}
                  onChange={(e) => setGoogleClientId(e.target.value)}
                  disabled={!data?.canManage}
                />
              </label>
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">Client Secret</span>
                <input
                  type="password"
                  autoComplete="off"
                  className="w-full rounded-card border border-ink/20 bg-white px-3 py-2 text-sm"
                  placeholder={data?.googleDrive?.configured ? "•••••••• (deixe em branco para manter)" : ""}
                  value={googleClientSecret}
                  onChange={(e) => setGoogleClientSecret(e.target.value)}
                  disabled={!data?.canManage}
                />
              </label>
              <button
                type="button"
                className="btn-primary"
                disabled={!data?.canManage || saveGoogle.isPending}
                onClick={() => saveGoogle.mutate()}
              >
                Salvar Google OAuth
              </button>
            </>
          )}
        </section>

        {msg ? <p className="text-sm text-muted">{msg}</p> : null}
    </div>
  );
}
