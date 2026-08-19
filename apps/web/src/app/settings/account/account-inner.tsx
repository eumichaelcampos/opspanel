"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { CheckCircle2, Cloud, Copy, ExternalLink, KeyRound, Link2, MessageSquare, Trash2, Unplug } from "lucide-react";

function ExternalDocLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
    >
      {children}
      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
    </a>
  );
}

type ApiKeyRow = {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt?: string | null;
};

type OpenAiStatus = {
  connected: boolean;
  hint?: string | null;
  updatedAt?: string | null;
  label?: string | null;
};

type CloudflareStatus = {
  connected: boolean;
  hint?: string | null;
  mode?: "token" | "global" | "oauth" | null;
  updatedAt?: string | null;
  label?: string | null;
  oauthConfigured?: boolean;
  oauthScopes?: string[];
};

type GoogleDriveStatus = {
  connected: boolean;
  hint?: string | null;
  oauthConfigured?: boolean;
  oauthMode?: "broker" | "local" | "none";
  redirectUri?: string;
};

type CodexStatus = {
  connected: boolean;
  hint?: string | null;
  updatedAt?: string | null;
  model?: string;
};

type CodexStart = {
  flowId: string;
  verifyUrl: string;
  userCode: string;
  expiresInSec: number;
};

function modeLabel(mode?: CloudflareStatus["mode"]) {
  if (mode === "oauth") return "OAuth";
  if (mode === "global") return "Global Key";
  if (mode === "token") return "API Token";
  return null;
}

export default function AccountSettingsPageInner() {
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [openAiKey, setOpenAiKey] = useState("");
  const [openAiMsg, setOpenAiMsg] = useState<string | null>(null);
  const [showOpenAiManual, setShowOpenAiManual] = useState(false);
  const [codexMsg, setCodexMsg] = useState<string | null>(null);
  const [codexFlow, setCodexFlow] = useState<CodexStart | null>(null);
  const [cfMode, setCfMode] = useState<"token" | "global">("token");
  const [cfToken, setCfToken] = useState("");
  const [cfEmail, setCfEmail] = useState("");
  const [cfGlobalKey, setCfGlobalKey] = useState("");
  const [cfMsg, setCfMsg] = useState<string | null>(null);
  const [googleMsg, setGoogleMsg] = useState<string | null>(null);
  const [showManualCf, setShowManualCf] = useState(false);

  useEffect(() => {
    const status = searchParams.get("cloudflare");
    if (status === "connected") {
      setCfMsg("Cloudflare conectado via OAuth.");
      void qc.invalidateQueries({ queryKey: ["me-cloudflare"] });
    } else if (status === "error") {
      setCfMsg(searchParams.get("message") || "Falha ao conectar Cloudflare via OAuth.");
    }
    const google = searchParams.get("google");
    if (google === "connected") {
      setGoogleMsg("Google Drive conectado.");
      void qc.invalidateQueries({ queryKey: ["me-google-drive"] });
    } else if (google === "error") {
      setGoogleMsg(searchParams.get("message") || "Falha ao conectar Google Drive.");
    }
  }, [searchParams, qc]);

  useEffect(() => {
    if (!codexFlow) return;
    let cancelled = false;

    const poll = async () => {
      while (!cancelled) {
        try {
          const r = await apiFetch<{ connected?: boolean; pending?: boolean }>("/me/openai/codex/poll", {
            method: "POST",
            body: JSON.stringify({ flowId: codexFlow.flowId }),
          });
          if (cancelled) return;
          if (r.connected) {
            setCodexFlow(null);
            setCodexMsg("ChatGPT conectado com sucesso.");
            void qc.invalidateQueries({ queryKey: ["me-codex"] });
            return;
          }
        } catch (err) {
          if (cancelled) return;
          setCodexFlow(null);
          setCodexMsg(err instanceof Error ? err.message : "Login expirado ou cancelado.");
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    };

    void poll();
    return () => {
      cancelled = true;
    };
  }, [codexFlow, qc]);

  const { data, isLoading } = useQuery({
    queryKey: ["api-keys"],
    queryFn: () => apiFetch<{ keys: ApiKeyRow[] }>("/api-keys"),
  });

  const { data: openAi } = useQuery({
    queryKey: ["me-openai"],
    queryFn: () => apiFetch<OpenAiStatus>("/me/openai"),
  });

  const { data: googleDrive } = useQuery({
    queryKey: ["me-google-drive"],
    queryFn: () => apiFetch<GoogleDriveStatus>("/me/google-drive"),
  });

  const { data: cloudflare } = useQuery({
    queryKey: ["me-cloudflare"],
    queryFn: () => apiFetch<CloudflareStatus>("/me/cloudflare"),
  });

  const { data: codex } = useQuery({
    queryKey: ["me-codex"],
    queryFn: () => apiFetch<CodexStatus>("/me/openai/codex"),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ key: string; name: string }>("/api-keys", {
        method: "POST",
        body: JSON.stringify({ name: newKeyName.trim() }),
      }),
    onSuccess: (r) => {
      setCreatedKey(r.key);
      setNewKeyName("");
      void qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (keyId: string) => apiFetch(`/api-keys/${keyId}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["api-keys"] }),
  });

  const connectOpenAi = useMutation({
    mutationFn: () =>
      apiFetch<{ connected: boolean; hint: string; model?: string }>("/me/openai", {
        method: "POST",
        body: JSON.stringify({ apiKey: openAiKey.trim() }),
      }),
    onSuccess: (r) => {
      setOpenAiKey("");
      setOpenAiMsg(`Conectado (${r.hint})${r.model ? ` · modelo ${r.model}` : ""}`);
      void qc.invalidateQueries({ queryKey: ["me-openai"] });
    },
    onError: (err) => {
      setOpenAiMsg(err instanceof Error ? err.message : "Falha ao conectar");
    },
  });

  const disconnectOpenAi = useMutation({
    mutationFn: () => apiFetch("/me/openai", { method: "DELETE" }),
    onSuccess: () => {
      setOpenAiMsg("Chave OpenAI removida.");
      void qc.invalidateQueries({ queryKey: ["me-openai"] });
    },
  });

  const startCodex = useMutation({
    mutationFn: () => apiFetch<CodexStart>("/me/openai/codex/start", { method: "POST" }),
    onSuccess: (r) => {
      setCodexFlow(r);
      setCodexMsg(null);
    },
    onError: (err) => setCodexMsg(err instanceof Error ? err.message : "Falha ao iniciar login"),
  });

  const disconnectCodex = useMutation({
    mutationFn: () => apiFetch("/me/openai/codex", { method: "DELETE" }),
    onSuccess: () => {
      setCodexMsg("ChatGPT desconectado.");
      setCodexFlow(null);
      void qc.invalidateQueries({ queryKey: ["me-codex"] });
    },
  });

  const connectCf = useMutation({
    mutationFn: () =>
      apiFetch<{ connected: boolean; hint: string; mode: string }>("/me/cloudflare", {
        method: "POST",
        body: JSON.stringify(
          cfMode === "token"
            ? { mode: "token", apiToken: cfToken.trim() }
            : { mode: "global", email: cfEmail.trim(), apiKey: cfGlobalKey.trim() },
        ),
      }),
    onSuccess: (r) => {
      setCfToken("");
      setCfGlobalKey("");
      setCfMsg(`Cloudflare conectado (${r.hint})`);
      void qc.invalidateQueries({ queryKey: ["me-cloudflare"] });
    },
    onError: (err) => {
      setCfMsg(err instanceof Error ? err.message : "Falha ao conectar Cloudflare");
    },
  });

  const disconnectCf = useMutation({
    mutationFn: () => apiFetch("/me/cloudflare", { method: "DELETE" }),
    onSuccess: () => {
      setCfMsg("Cloudflare desconectado.");
      void qc.invalidateQueries({ queryKey: ["me-cloudflare"] });
    },
  });

  const disconnectGoogle = useMutation({
    mutationFn: () => apiFetch("/me/google-drive", { method: "DELETE" }),
    onSuccess: () => {
      setGoogleMsg("Google Drive desconectado.");
      void qc.invalidateQueries({ queryKey: ["me-google-drive"] });
    },
  });

  const mcpConfig = `{
  "mcpServers": {
    "opspanel": {
      "command": "npx",
      "args": ["-y", "@opspanel/mcp-server"],
      "env": {
        "OPSPANEL_API_URL": "http://localhost:3001",
        "OPSPANEL_API_KEY": "opk_sua_chave_aqui"
      }
    }
  }
}`;

  const cfCanSubmit =
    cfMode === "token"
      ? cfToken.trim().length >= 20
      : cfEmail.includes("@") && cfGlobalKey.trim().length >= 20;

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <p className="text-sm text-muted">
        Conecte serviços externos usados pelo painel: assistente IA, Cloudflare e chaves para Cursor/MCP.
      </p>

      <div className="space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">Assistente IA</h2>

        <section className="glass-card space-y-4 p-5">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-accent" />
            <h3 className="font-semibold">ChatGPT (assinatura)</h3>
          </div>
          <p className="text-sm text-muted">
            Forma recomendada: use sua assinatura Plus/Pro no assistente do painel, sem API key separada.
          </p>

          {codex?.connected ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-success/30 bg-success/5 px-3 py-3 text-sm">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-success" />
                <div>
                  <p className="font-medium text-ink">Conectado · {codex.model ?? "Codex"}</p>
                  <p className="font-mono text-xs text-muted">{codex.hint}</p>
                </div>
              </div>
              <button
                type="button"
                className="btn-danger btn-sm"
                disabled={disconnectCodex.isPending}
                onClick={() => {
                  if (window.confirm("Desconectar ChatGPT deste usuário?")) disconnectCodex.mutate();
                }}
              >
                <Unplug className="h-3.5 w-3.5" />
                Desconectar
              </button>
            </div>
          ) : codexFlow ? (
            <div className="space-y-3 rounded-card border border-accent/30 bg-accent/5 px-4 py-4 text-sm">
              <p className="font-medium text-ink">Autorize no navegador:</p>
              <ol className="list-decimal space-y-1 pl-4 text-muted">
                <li>
                  Abra{" "}
                  <a href={codexFlow.verifyUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                    {codexFlow.verifyUrl}
                  </a>
                </li>
                <li>
                  Informe o código:{" "}
                  <code className="rounded bg-white px-2 py-0.5 font-mono text-base font-bold">{codexFlow.userCode}</code>
                  <button
                    type="button"
                    className="ml-2 inline-flex items-center gap-1 text-xs text-accent"
                    onClick={() => void navigator.clipboard.writeText(codexFlow.userCode)}
                  >
                    <Copy className="h-3 w-3" /> Copiar
                  </button>
                </li>
                <li>Aguardando confirmação…</li>
              </ol>
              <button type="button" className="btn-secondary btn-sm" onClick={() => setCodexFlow(null)}>
                Cancelar
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn-primary"
              disabled={startCodex.isPending}
              onClick={() => startCodex.mutate()}
            >
              <Link2 className="h-4 w-4" />
              {startCodex.isPending ? "Iniciando…" : "Conectar com ChatGPT"}
            </button>
          )}
          {codexMsg ? <p className="text-sm text-muted">{codexMsg}</p> : null}
        </section>

        <section className="glass-card space-y-4 p-5">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-accent" />
            <h3 className="font-semibold">OpenAI API (opcional)</h3>
          </div>
          <p className="text-sm text-muted">
            Alternativa com cobrança na OpenAI Platform. Só use se preferir API key em vez da assinatura ChatGPT.
          </p>

          {openAi?.connected ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-success/30 bg-success/5 px-3 py-3 text-sm">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-success" />
                <div>
                  <p className="font-medium text-ink">Conectado</p>
                  <p className="font-mono text-xs text-muted">{openAi.hint}</p>
                </div>
              </div>
              <button
                type="button"
                className="btn-danger btn-sm"
                disabled={disconnectOpenAi.isPending}
                onClick={() => {
                  if (window.confirm("Remover a chave OpenAI deste usuário?")) disconnectOpenAi.mutate();
                }}
              >
                <Unplug className="h-3.5 w-3.5" />
                Desconectar
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {!showOpenAiManual ? (
                <button
                  type="button"
                  className="text-sm text-accent hover:underline"
                  onClick={() => setShowOpenAiManual(true)}
                >
                  Usar API key da OpenAI Platform
                </button>
              ) : (
                <>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-card bg-ink/5 px-3 py-2">
                    <ExternalDocLink href="https://platform.openai.com/api-keys">Criar API key</ExternalDocLink>
                  </div>
                  <label className="block space-y-1.5 text-sm">
                    <span className="font-medium text-ink">API key (sk-…)</span>
                    <input
                      type="password"
                      autoComplete="off"
                      className="w-full rounded-card border border-ink/20 bg-white px-3 py-2 text-sm"
                      placeholder="sk-..."
                      value={openAiKey}
                      onChange={(e) => setOpenAiKey(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={openAiKey.trim().length < 20 || connectOpenAi.isPending}
                    onClick={() => connectOpenAi.mutate()}
                  >
                    <Link2 className="h-4 w-4" />
                    {connectOpenAi.isPending ? "Validando…" : "Salvar API key"}
                  </button>
                </>
              )}
            </div>
          )}
          {openAiMsg ? <p className="text-sm text-muted">{openAiMsg}</p> : null}
        </section>
      </div>

      <div className="space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">Cloudflare</h2>

        <section className="glass-card space-y-4 p-5">
          <div className="flex items-center gap-2">
            <Cloud className="h-4 w-4 text-accent" />
            <h3 className="font-semibold">Conta Cloudflare</h3>
          </div>
          <p className="text-sm text-muted">
            Necessário para gerenciar DNS, otimizações e page rules no detalhe de cada site.
          </p>

          {cloudflare?.connected ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-success/30 bg-success/5 px-3 py-3 text-sm">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-success" />
                <div>
                  <p className="font-medium text-ink">
                    Conectado
                    {modeLabel(cloudflare.mode) ? ` · ${modeLabel(cloudflare.mode)}` : ""}
                  </p>
                  <p className="font-mono text-xs text-muted">{cloudflare.hint}</p>
                </div>
              </div>
              <button
                type="button"
                className="btn-danger btn-sm"
                disabled={disconnectCf.isPending}
                onClick={() => {
                  if (window.confirm("Remover credenciais Cloudflare deste usuário?")) disconnectCf.mutate();
                }}
              >
                <Unplug className="h-3.5 w-3.5" />
                Desconectar
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {cloudflare?.oauthConfigured ? (
                <div className="space-y-2">
                  <a href="/api/v1/me/cloudflare/oauth/start" className="btn-primary inline-flex">
                    <Cloud className="h-4 w-4" />
                    Conectar com Cloudflare
                  </a>
                  <p className="text-xs text-muted">
                    Você autoriza DNS, Zone Settings e Page Rules na tela da Cloudflare.
                  </p>
                </div>
              ) : (
                <div className="rounded-card border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
                  <p className="font-medium text-warning">OAuth ainda não configurado no servidor</p>
                  <p className="mt-1 text-xs text-muted">
                    Use API Token abaixo enquanto o admin configura o OAuth client.
                  </p>
                </div>
              )}

              <button
                type="button"
                className="text-sm text-accent hover:underline"
                onClick={() => setShowManualCf((v) => !v)}
              >
                {showManualCf ? "Ocultar conexão manual" : "Conectar com API Token"}
              </button>

              {showManualCf || !cloudflare?.oauthConfigured ? (
                <div className="space-y-3 border-t border-ink/10 pt-3">
                  <div className="flex gap-2 text-sm">
                    <button
                      type="button"
                      className={cfMode === "token" ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
                      onClick={() => setCfMode("token")}
                    >
                      API Token
                    </button>
                    <button
                      type="button"
                      className={cfMode === "global" ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
                      onClick={() => setCfMode("global")}
                    >
                      Global API Key
                    </button>
                  </div>
                  {cfMode === "token" ? (
                    <label className="block space-y-1.5 text-sm">
                      <span className="font-medium text-ink">API Token</span>
                      <input
                        type="password"
                        autoComplete="off"
                        className="w-full rounded-card border border-ink/20 bg-white px-3 py-2 text-sm"
                        placeholder="Token com Zone:DNS:Edit…"
                        value={cfToken}
                        onChange={(e) => setCfToken(e.target.value)}
                      />
                    </label>
                  ) : (
                    <div className="space-y-3">
                      <label className="block space-y-1.5 text-sm">
                        <span className="font-medium text-ink">E-mail Cloudflare</span>
                        <input
                          type="email"
                          autoComplete="off"
                          className="w-full rounded-card border border-ink/20 bg-white px-3 py-2 text-sm"
                          value={cfEmail}
                          onChange={(e) => setCfEmail(e.target.value)}
                        />
                      </label>
                      <label className="block space-y-1.5 text-sm">
                        <span className="font-medium text-ink">Global API Key</span>
                        <input
                          type="password"
                          autoComplete="off"
                          className="w-full rounded-card border border-ink/20 bg-white px-3 py-2 text-sm"
                          value={cfGlobalKey}
                          onChange={(e) => setCfGlobalKey(e.target.value)}
                        />
                      </label>
                    </div>
                  )}
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={!cfCanSubmit || connectCf.isPending}
                    onClick={() => connectCf.mutate()}
                  >
                    <Link2 className="h-4 w-4" />
                    {connectCf.isPending ? "Validando…" : "Salvar credencial"}
                  </button>
                </div>
              ) : null}
            </div>
          )}
          {cfMsg ? <p className="text-sm text-muted">{cfMsg}</p> : null}
        </section>
      </div>

      <div className="space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">Acesso externo</h2>

        <section className="glass-card space-y-4 p-5">
          <h3 className="font-semibold">Chaves de API do OpsPanel</h3>
          <p className="text-sm text-muted">Use no Cursor, Claude Desktop ou MCP server.</p>

          {createdKey ? (
            <div className="rounded-card border border-success/40 bg-success/5 p-4 text-sm">
              <p className="font-medium text-success">Chave criada (copie agora, não será exibida novamente)</p>
              <code className="mt-2 block break-all rounded bg-white/80 p-2 font-mono text-xs">{createdKey}</code>
              <button
                type="button"
                className="mt-2 inline-flex items-center gap-1 text-xs text-accent"
                onClick={() => void navigator.clipboard.writeText(createdKey)}
              >
                <Copy className="h-3 w-3" /> Copiar
              </button>
            </div>
          ) : null}

          <div className="flex gap-2">
            <input
              className="flex-1 rounded-card border border-ink/20 bg-white px-3 py-2 text-sm focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
              placeholder="Nome da chave (ex: Cursor)"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
            />
            <button
              type="button"
              disabled={newKeyName.trim().length < 2 || createMutation.isPending}
              onClick={() => createMutation.mutate()}
              className="btn-primary"
            >
              Gerar
            </button>
          </div>

          {isLoading ? <p className="text-sm text-muted">Carregando…</p> : null}
          <ul className="space-y-2">
            {data?.keys.map((k) => (
              <li key={k.id} className="flex items-center justify-between rounded-card bg-white/80 px-3 py-2 text-sm">
                <div>
                  <p className="font-medium">{k.name}</p>
                  <p className="font-mono text-xs text-muted">{k.keyPrefix}…</p>
                </div>
                <button
                  type="button"
                  className="text-danger hover:opacity-80"
                  title="Revogar"
                  onClick={() => {
                    if (window.confirm(`Revogar chave "${k.name}"?`)) revokeMutation.mutate(k.id);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
          {createMutation.error ? (
            <p className="text-sm text-danger">{(createMutation.error as Error).message}</p>
          ) : null}
        </section>

        <section className="glass-card space-y-4 p-5">
          <div className="flex items-center gap-2">
            <Cloud className="h-4 w-4 text-accent" />
            <h3 className="font-semibold">Google Drive</h3>
          </div>
          <p className="text-sm text-muted">
            Envie backups dos sites para a sua conta Google e mantenha o servidor mais leve.
          </p>
          {googleDrive?.connected ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-success/30 bg-success/5 px-3 py-3 text-sm">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-success" />
                <div>
                  <p className="font-medium text-ink">Conectado</p>
                  <p className="font-mono text-xs text-muted">{googleDrive.hint}</p>
                </div>
              </div>
              <button
                type="button"
                className="btn-danger btn-sm"
                disabled={disconnectGoogle.isPending}
                onClick={() => {
                  if (window.confirm("Desconectar Google Drive desta conta?")) disconnectGoogle.mutate();
                }}
              >
                <Unplug className="h-3.5 w-3.5" />
                Desconectar
              </button>
            </div>
          ) : googleDrive?.oauthConfigured ? (
            <a href="/api/v1/me/google-drive/oauth/start" className="btn-primary inline-flex">
              <Cloud className="h-4 w-4" />
              Conectar Google Drive
            </a>
          ) : (
            <div className="rounded-card border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
              <p className="font-medium text-warning">OAuth do Google ainda não configurado</p>
              <p className="mt-1 text-xs text-muted">
                Peça ao administrador para ativar o OAuth central da OpsPanel, ou informar Client ID e Secret em
                Configurações → Empresa.
                {googleDrive?.redirectUri ? (
                  <>
                    {" "}
                    URI de retorno local: <code className="break-all">{googleDrive.redirectUri}</code>
                  </>
                ) : null}
              </p>
            </div>
          )}
          {googleMsg ? <p className="text-sm text-muted">{googleMsg}</p> : null}
        </section>

        <section className="glass-card space-y-3 p-5">
          <h3 className="font-semibold">MCP no Cursor / Claude Desktop</h3>
          <p className="text-sm text-muted">
            Cole no arquivo <code className="text-xs">.cursor/mcp.json</code> e troque a API key:
          </p>
          <pre className="overflow-x-auto rounded-card bg-ink/5 p-4 text-xs">{mcpConfig}</pre>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => void navigator.clipboard.writeText(mcpConfig)}
          >
            <Copy className="h-4 w-4" /> Copiar configuração
          </button>
        </section>
      </div>
    </div>
  );
}
