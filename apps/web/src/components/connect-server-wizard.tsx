"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { CheckCircle2, Loader2, Package, Plus, Server, Sparkles } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { JobTracker } from "@/components/job-tracker";
import { importExistingWordOps, provisionNewWordOps, type BootstrapStep } from "@/lib/server-bootstrap";
import { cn } from "@/lib/utils";

type Kind = "existing" | "fresh";

type ServerRow = {
  id: string;
  name: string;
  host: string;
  port: number;
  status: string;
  wordopsVersion?: string | null;
  siteCount?: number;
};

type Props = {
  variant: "first-run" | "add";
  onFinished?: () => void;
};

export function ConnectServerWizard({ variant, onFinished }: Props) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<Kind | null>(null);
  const [name, setName] = useState("Servidor principal");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState("root");
  const [password, setPassword] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [authType, setAuthType] = useState<"ssh_password" | "ssh_private_key">("ssh_password");
  const [privateKey, setPrivateKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"form" | "working" | "done">("form");
  const [step, setStep] = useState<BootstrapStep | null>(null);
  const [activeServer, setActiveServer] = useState<ServerRow | null>(null);
  const [wordopsFound, setWordopsFound] = useState<string | null>(null);
  const cancelRef = useRef({ cancelled: false });

  const serversQuery = useQuery({
    queryKey: ["servers"],
    queryFn: () => apiFetch<{ servers: ServerRow[] }>("/servers"),
  });

  const servers = serversQuery.data?.servers ?? [];

  useEffect(() => {
    return () => {
      cancelRef.current.cancelled = true;
    };
  }, []);

  function resetForm() {
    setKind(null);
    setHost("");
    setPassword("");
    setPrivateKey("");
    setPort(22);
    setUsername("root");
    setName(servers.length ? `Servidor ${servers.length + 1}` : "Servidor principal");
    setPhase("form");
    setStep(null);
    setActiveServer(null);
    setWordopsFound(null);
    setError(null);
    setBusy(false);
  }

  async function connectAndAct() {
    if (!kind) {
      setError("Escolha se o servidor já tem WordOps ou se é novo.");
      return;
    }
    setError(null);
    setBusy(true);
    setPhase("working");
    cancelRef.current = { cancelled: false };
    try {
      const credential =
        authType === "ssh_private_key"
          ? { type: authType, username: username.trim(), privateKey }
          : { type: authType, username: username.trim(), password };
      const created = await apiFetch<ServerRow>("/servers", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim() || host.trim(),
          host: host.trim(),
          port,
          tags: [kind === "existing" ? "wordops-existente" : "servidor-novo"],
          credential,
        }),
      });
      setActiveServer(created);

      if (kind === "existing") {
        const result = await importExistingWordOps(created.id, setStep, cancelRef.current);
        setWordopsFound(result.wordopsVersion ?? null);
        if (!result.wordopsVersion) {
          setError(
            "Conectamos, mas o WordOps não apareceu neste servidor. Confira se ele já estava instalado ou escolha a opção de servidor novo.",
          );
        }
      } else {
        await provisionNewWordOps(created.id, setStep, cancelRef.current);
      }

      await qc.invalidateQueries({ queryKey: ["servers"] });
      const refreshed = await apiFetch<{ servers: ServerRow[] }>("/servers");
      const latest = refreshed.servers.find((s) => s.id === created.id) ?? created;
      setActiveServer(latest);
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível concluir. Confira IP, porta e senha.");
      setPhase("form");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {servers.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-ink">Servidores neste painel</h2>
          <ul className="space-y-2">
            {servers.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-white/80 bg-white/80 px-3 py-2 text-sm"
              >
                <div>
                  <p className="font-medium">{s.name}</p>
                  <p className="text-xs text-muted">
                    {s.host}:{s.port}
                    {s.wordopsVersion ? ` · WordOps ${s.wordopsVersion}` : ""}
                  </p>
                </div>
                <Link href={`/servers/${s.id}`} className="btn-secondary btn-sm">
                  Abrir
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {phase === "done" && activeServer ? (
        <section className="space-y-4 rounded-card border border-success/30 bg-success/5 p-5">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-6 w-6 text-success" />
            <div>
              <h2 className="font-semibold text-ink">{activeServer.name} está no painel</h2>
              <p className="mt-1 text-sm text-muted">
                {wordopsFound
                  ? `WordOps ${wordopsFound} reconhecido. Os sites deste servidor aparecem em Sites.`
                  : kind === "fresh"
                    ? "WordOps foi instalado. Agora você pode criar sites neste servidor."
                    : "Servidor cadastrado. Se os sites não aparecerem, abra o servidor e clique em sincronizar."}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/servers/${activeServer.id}`} className="btn-secondary">
              Ver servidor
            </Link>
            <Link href="/sites" className="btn-secondary">
              Ver sites
            </Link>
            <button type="button" className="btn-primary" onClick={resetForm}>
              <Plus className="h-4 w-4" />
              Adicionar outro servidor
            </button>
            {variant === "first-run" ? (
              <Link href="/dashboard" className="btn-secondary">
                Ir para o painel
              </Link>
            ) : (
              <button type="button" className="btn-secondary" onClick={() => onFinished?.()}>
                Concluir
              </button>
            )}
          </div>
        </section>
      ) : null}

      {phase !== "done" ? (
        <section className="space-y-5">
          <div>
            <h2 className="text-lg font-semibold text-ink">
              {servers.length ? "Adicionar mais um servidor" : "Conectar o servidor dos seus sites"}
            </h2>
            <p className="mt-1 text-sm text-muted">
              Use o IP e a senha que a hospedagem enviou por e-mail. Não precisa de conhecimento técnico.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => setKind("existing")}
              className={cn(
                "rounded-card border p-4 text-left transition",
                kind === "existing"
                  ? "border-accent bg-accent/10 ring-1 ring-accent/30"
                  : "border-ink/10 bg-white/80 hover:border-accent/40",
              )}
            >
              <Package className="h-5 w-5 text-accent" />
              <p className="mt-2 font-semibold">Já tem WordOps</p>
              <p className="mt-1 text-sm text-muted">
                O servidor já hospeda sites. Vamos reconhecer tudo e trazer para o painel.
              </p>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setKind("fresh")}
              className={cn(
                "rounded-card border p-4 text-left transition",
                kind === "fresh"
                  ? "border-accent bg-accent/10 ring-1 ring-accent/30"
                  : "border-ink/10 bg-white/80 hover:border-accent/40",
              )}
            >
              <Sparkles className="h-5 w-5 text-accent" />
              <p className="mt-2 font-semibold">Servidor novo</p>
              <p className="mt-1 text-sm text-muted">
                Ubuntu vazio. O painel instala o WordOps e a stack para você criar sites.
              </p>
            </button>
          </div>

          {kind ? (
            <div className="space-y-4 rounded-card border border-ink/10 bg-white/80 p-4">
              <label className="block space-y-1 text-sm">
                <span className="font-medium">Nome (só para você reconhecer)</span>
                <input
                  className="w-full rounded-card border border-ink/20 bg-white px-3 py-2"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Servidor principal"
                  disabled={busy}
                />
              </label>
              <label className="block space-y-1 text-sm">
                <span className="font-medium">IP do servidor</span>
                <input
                  className="w-full rounded-card border border-ink/20 bg-white px-3 py-2 font-mono"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="123.45.67.89"
                  disabled={busy}
                  required
                />
                <span className="text-xs text-muted">Está no e-mail da VPS ou no painel da hospedagem.</span>
              </label>
              <label className="block space-y-1 text-sm">
                <span className="font-medium">Senha de acesso (usuário root)</span>
                <input
                  type="password"
                  autoComplete="off"
                  className="w-full rounded-card border border-ink/20 bg-white px-3 py-2"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy || authType === "ssh_private_key"}
                />
              </label>

              <button
                type="button"
                className="text-sm text-accent hover:underline"
                onClick={() => setShowAdvanced((v) => !v)}
              >
                {showAdvanced ? "Ocultar opções avançadas" : "Porta, usuário ou chave SSH"}
              </button>
              {showAdvanced ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block space-y-1 text-sm">
                    <span className="font-medium">Porta SSH</span>
                    <input
                      type="number"
                      className="w-full rounded-card border border-ink/20 bg-white px-3 py-2"
                      value={port}
                      onChange={(e) => setPort(Number(e.target.value) || 22)}
                      disabled={busy}
                    />
                    <span className="text-xs text-muted">Quase sempre 22. Algumas hospedagens usam 22022.</span>
                  </label>
                  <label className="block space-y-1 text-sm">
                    <span className="font-medium">Usuário</span>
                    <input
                      className="w-full rounded-card border border-ink/20 bg-white px-3 py-2"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      disabled={busy}
                    />
                  </label>
                  <label className="block space-y-1 text-sm sm:col-span-2">
                    <span className="font-medium">Autenticação</span>
                    <select
                      className="w-full rounded-card border border-ink/20 bg-white px-3 py-2"
                      value={authType}
                      onChange={(e) => setAuthType(e.target.value as typeof authType)}
                      disabled={busy}
                    >
                      <option value="ssh_password">Senha</option>
                      <option value="ssh_private_key">Chave privada</option>
                    </select>
                  </label>
                  {authType === "ssh_private_key" ? (
                    <label className="block space-y-1 text-sm sm:col-span-2">
                      <span className="font-medium">Chave privada</span>
                      <textarea
                        className="min-h-28 w-full rounded-card border border-ink/20 bg-white px-3 py-2 font-mono text-xs"
                        value={privateKey}
                        onChange={(e) => setPrivateKey(e.target.value)}
                        disabled={busy}
                      />
                    </label>
                  ) : null}
                </div>
              ) : null}

              {error ? <p className="rounded-card bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p> : null}

              {phase === "working" ? (
                <div className="space-y-3">
                  <p className="flex items-center gap-2 text-sm font-medium text-ink">
                    <Loader2 className="h-4 w-4 animate-spin text-accent" />
                    {step?.label ?? "Trabalhando no servidor…"}
                  </p>
                  {kind === "fresh" ? (
                    <p className="text-xs text-muted">
                      Instalação nova pode levar de 15 a 25 minutos. Deixe esta página aberta.
                    </p>
                  ) : (
                    <p className="text-xs text-muted">Vamos conectar, reconhecer o WordOps e importar os sites.</p>
                  )}
                  {step?.jobId ? <JobTracker jobId={step.jobId} /> : null}
                </div>
              ) : (
                <button
                  type="button"
                  className="btn-primary w-full justify-center py-2.5"
                  disabled={
                    busy ||
                    !host.trim() ||
                    (authType === "ssh_password" ? password.length < 1 : privateKey.length < 32)
                  }
                  onClick={() => void connectAndAct()}
                >
                  <Server className="h-4 w-4" />
                  {kind === "existing" ? "Conectar e sincronizar tudo" : "Conectar e instalar WordOps"}
                </button>
              )}
            </div>
          ) : null}

          {variant === "first-run" && !busy ? (
            <p className="text-center text-sm text-muted">
              <Link href="/dashboard" className="text-accent hover:underline">
                Fazer isso depois
              </Link>
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
