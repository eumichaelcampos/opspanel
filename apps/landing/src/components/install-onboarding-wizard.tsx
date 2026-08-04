"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Download,
  Globe,
  Hexagon,
  Key,
  Network,
  Server,
  Shield,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  buildInstallArtifacts,
  defaultInstallDraft,
  generateRandomSecret,
  INSTALL_STEPS,
  type AccessMode,
  type InstallDraft,
  type InstallStepId,
  validateStep,
} from "@/lib/install-config";
import { panelUrl } from "@/lib/panel-url";

function CopyBlock({ label, content }: { label: string; content: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="overflow-hidden rounded-card border border-white/70">
      <div className="flex items-center justify-between border-b border-white/60 bg-white/60 px-3 py-2">
        <span className="text-xs font-medium text-ink">{label}</span>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
          onClick={() => {
            void navigator.clipboard.writeText(content);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          <Copy className="h-3 w-3" />
          {copied ? "Copiado!" : "Copiar"}
        </button>
      </div>
      <pre className="max-h-64 overflow-auto bg-ink/5 p-3 text-[11px] leading-relaxed text-ink/90">
        <code>{content}</code>
      </pre>
    </div>
  );
}

const ACCESS_OPTIONS: {
  id: AccessMode;
  title: string;
  desc: string;
  icon: typeof Server;
  example: string;
}[] = [
  {
    id: "ip",
    title: "IP do servidor",
    desc: "Acesso direto pela porta (ideal para testes ou rede interna).",
    icon: Server,
    example: "http://143.95.220.80:3000",
  },
  {
    id: "domain",
    title: "Domínio dedicado",
    desc: "Painel em um domínio próprio com HTTPS e proxy reverso.",
    icon: Globe,
    example: "https://panel.suaempresa.com.br",
  },
  {
    id: "subdomain",
    title: "Subdomínio",
    desc: "Use ops.seudominio.com ou panel.seudominio.com.",
    icon: Network,
    example: "https://ops.seudominio.com.br",
  },
];

export function InstallOnboardingWizard() {
  const [stepIndex, setStepIndex] = useState(0);
  const [draft, setDraft] = useState<InstallDraft>(() => defaultInstallDraft());
  const [error, setError] = useState<string | null>(null);

  const step = INSTALL_STEPS[stepIndex]!;
  const artifacts = useMemo(() => buildInstallArtifacts(draft), [draft]);

  function patch(p: Partial<InstallDraft>) {
    setDraft((prev) => ({ ...prev, ...p }));
    setError(null);
  }

  function next() {
    const err = validateStep(step.id, draft);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setStepIndex((i) => Math.min(i + 1, INSTALL_STEPS.length - 1));
  }

  function back() {
    setError(null);
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-white/60 bg-white/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-4">
          <Link href="/" className="flex items-center gap-2 text-sm text-muted hover:text-ink">
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </Link>
          <div className="flex items-center gap-2">
            <Hexagon className="h-5 w-5 text-accent" />
            <span className="font-semibold text-ink">Instalação OpsPanel</span>
          </div>
          <Link href={panelUrl("/login")} className="text-sm text-accent hover:underline">
            Já instalou?
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-6 py-8">
        <nav className="mb-8 flex flex-wrap gap-1">
          {INSTALL_STEPS.map((s, i) => (
            <div
              key={s.id}
              className={cn(
                "flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium",
                i === stepIndex ? "bg-accent text-white" : i < stepIndex ? "bg-success/15 text-success" : "bg-white/60 text-muted",
              )}
            >
              {i < stepIndex ? <Check className="h-3 w-3" /> : <span>{i + 1}</span>}
              {s.label}
            </div>
          ))}
        </nav>

        <div className="glass-panel space-y-6 p-6 lg:p-8">
          {step.id === "welcome" ? (
            <>
              <h1 className="text-2xl font-bold text-ink">Configure sua instalação</h1>
              <p className="text-muted">
                Este assistente gera o <code className="text-xs">.env</code>, configuração de proxy (Nginx/Caddy) e
                comandos de instalação personalizados para o seu cenário: IP, domínio ou subdomínio.
              </p>
              <ul className="space-y-2 text-sm text-muted">
                <li>• Node.js 20+, pnpm 9+, Docker (PostgreSQL + Redis)</li>
                <li>• VPS Linux ou servidor dedicado para hospedar o painel</li>
                <li>• Domínio opcional com DNS apontando para o IP da VPS</li>
              </ul>
            </>
          ) : null}

          {step.id === "access" ? (
            <>
              <h2 className="text-xl font-semibold text-ink">Como você vai acessar o painel?</h2>
              <div className="grid gap-3">
                {ACCESS_OPTIONS.map(({ id, title, desc, icon: Icon, example }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      patch({
                        accessMode: id,
                        useHttps: id !== "ip",
                        apiLayout: id === "ip" ? "direct-ports" : "same-origin",
                        proxyEngine: id === "ip" ? "none" : "nginx",
                      });
                    }}
                    className={cn(
                      "rounded-card border p-4 text-left transition",
                      draft.accessMode === id
                        ? "border-accent bg-accent/10 shadow-sm"
                        : "border-white/80 bg-white/70 hover:border-accent/30",
                    )}
                  >
                    <div className="flex gap-3">
                      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
                      <div>
                        <p className="font-medium text-ink">{title}</p>
                        <p className="mt-1 text-sm text-muted">{desc}</p>
                        <p className="mt-2 font-mono text-[10px] text-accent/80">{example}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          ) : null}

          {step.id === "address" ? (
            <>
              <h2 className="text-xl font-semibold text-ink">Endereço e infraestrutura</h2>
              {draft.accessMode === "ip" ? (
                <label className="block space-y-1 text-sm">
                  <span className="text-muted">IP público da VPS</span>
                  <input
                    className="w-full rounded-card border bg-white px-3 py-2 font-mono text-sm"
                    placeholder="143.95.220.80"
                    value={draft.serverIp}
                    onChange={(e) => patch({ serverIp: e.target.value })}
                  />
                </label>
              ) : (
                <>
                  <label className="block space-y-1 text-sm">
                    <span className="text-muted">Domínio raiz</span>
                    <input
                      className="w-full rounded-card border bg-white px-3 py-2 text-sm"
                      placeholder="suaempresa.com.br"
                      value={draft.domain}
                      onChange={(e) => patch({ domain: e.target.value.toLowerCase() })}
                    />
                  </label>
                  {draft.accessMode === "subdomain" ? (
                    <label className="block space-y-1 text-sm">
                      <span className="text-muted">Subdomínio do painel</span>
                      <div className="flex items-center gap-2">
                        <input
                          className="w-32 rounded-card border bg-white px-3 py-2 text-sm"
                          placeholder="ops"
                          value={draft.subdomain}
                          onChange={(e) => patch({ subdomain: e.target.value.toLowerCase() })}
                        />
                        <span className="text-muted">.{draft.domain || "seudominio.com"}</span>
                      </div>
                    </label>
                  ) : null}
                  <label className="block space-y-1 text-sm">
                    <span className="text-muted">IP público (para registros DNS)</span>
                    <input
                      className="w-full rounded-card border bg-white px-3 py-2 font-mono text-sm"
                      placeholder="143.95.220.80"
                      value={draft.serverIp}
                      onChange={(e) => patch({ serverIp: e.target.value })}
                    />
                  </label>
                </>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-1 text-sm">
                  <span className="text-muted">Porta Web (Next.js)</span>
                  <input
                    type="number"
                    className="w-full rounded-card border bg-white px-3 py-2 text-sm"
                    value={draft.webPort}
                    onChange={(e) => patch({ webPort: Number(e.target.value) })}
                  />
                </label>
                <label className="block space-y-1 text-sm">
                  <span className="text-muted">Porta API</span>
                  <input
                    type="number"
                    className="w-full rounded-card border bg-white px-3 py-2 text-sm"
                    value={draft.apiPort}
                    onChange={(e) => patch({ apiPort: Number(e.target.value) })}
                  />
                </label>
              </div>
              <label className="block space-y-1 text-sm">
                <span className="text-muted">PostgreSQL (DATABASE_URL)</span>
                <input
                  className="w-full rounded-card border bg-white px-3 py-2 font-mono text-xs"
                  value={draft.databaseUrl}
                  onChange={(e) => patch({ databaseUrl: e.target.value })}
                />
              </label>
              <label className="block space-y-1 text-sm">
                <span className="text-muted">Redis (REDIS_URL)</span>
                <input
                  className="w-full rounded-card border bg-white px-3 py-2 font-mono text-xs"
                  value={draft.redisUrl}
                  onChange={(e) => patch({ redisUrl: e.target.value })}
                />
              </label>
            </>
          ) : null}

          {step.id === "api" ? (
            <>
              <h2 className="text-xl font-semibold text-ink">API, HTTPS e proxy</h2>
              {draft.accessMode === "ip" ? (
                <>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.useHttps}
                      onChange={(e) => patch({ useHttps: e.target.checked })}
                      className="accent-accent"
                    />
                    Usar HTTPS (requer certificado no IP ou proxy)
                  </label>
                  <p className="text-sm font-medium text-ink">Exposição da API</p>
                  <div className="grid gap-2">
                    {(
                      [
                        ["direct-ports", "Portas diretas (3000 + 3001)", "Mais simples para testes"],
                        ["same-origin", "Proxy Nginx (recomendado)", "Apenas 80/443 expostos"],
                      ] as const
                    ).map(([id, title, desc]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => patch({ apiLayout: id, proxyEngine: id === "same-origin" ? "nginx" : "none" })}
                        className={cn(
                          "rounded-card border px-3 py-2 text-left text-sm",
                          draft.apiLayout === id ? "border-accent bg-accent/10" : "border-white/80 bg-white/70",
                        )}
                      >
                        <p className="font-medium">{title}</p>
                        <p className="text-xs text-muted">{desc}</p>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.useHttps}
                      onChange={(e) => patch({ useHttps: e.target.checked })}
                      className="accent-accent"
                    />
                    HTTPS com Let&apos;s Encrypt (recomendado)
                  </label>
                  <p className="text-sm font-medium text-ink">Como expor a API?</p>
                  <div className="grid gap-2">
                    {(
                      [
                        ["same-origin", "Mesmo domínio (/api/v1 via proxy)", "Recomendado: cookies e CORS simples"],
                        ["api-subdomain", "Subdomínio da API", "Ex: api.seudominio.com"],
                      ] as const
                    ).map(([id, title, desc]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => patch({ apiLayout: id })}
                        className={cn(
                          "rounded-card border px-3 py-2 text-left text-sm",
                          draft.apiLayout === id ? "border-accent bg-accent/10" : "border-white/80 bg-white/70",
                        )}
                      >
                        <p className="font-medium">{title}</p>
                        <p className="text-xs text-muted">{desc}</p>
                      </button>
                    ))}
                  </div>
                  {draft.apiLayout === "api-subdomain" ? (
                    <label className="block space-y-1 text-sm">
                      <span className="text-muted">Prefixo do subdomínio da API</span>
                      <div className="flex items-center gap-2">
                        <input
                          className="w-24 rounded-card border bg-white px-3 py-2 text-sm"
                          value={draft.apiSubdomainPrefix}
                          onChange={(e) => patch({ apiSubdomainPrefix: e.target.value.toLowerCase() })}
                        />
                        <span className="text-muted">.{draft.domain || "seudominio.com"}</span>
                      </div>
                    </label>
                  ) : null}
                  <p className="text-sm font-medium text-ink">Proxy reverso</p>
                  <div className="flex gap-2">
                    {(["nginx", "caddy"] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => patch({ proxyEngine: p })}
                        className={cn(
                          "rounded-full px-4 py-1.5 text-sm capitalize",
                          draft.proxyEngine === p ? "bg-accent text-white" : "bg-white/80 text-muted",
                        )}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <div className="rounded-card border border-accent/20 bg-accent/5 p-3 text-sm">
                <p className="font-medium text-ink">URLs geradas</p>
                <p className="mt-1 font-mono text-xs text-muted">WEB_URL={artifacts.webUrl}</p>
                <p className="font-mono text-xs text-muted">API_URL={artifacts.apiUrl}</p>
              </div>
            </>
          ) : null}

          {step.id === "secrets" ? (
            <>
              <h2 className="text-xl font-semibold text-ink">Segurança e admin inicial</h2>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-card border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-accent"
                  onClick={() => patch({ sessionSecret: generateRandomSecret(32) })}
                >
                  <Key className="h-4 w-4" />
                  Gerar SESSION_SECRET
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-card border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-accent"
                  onClick={() => patch({ encryptionKey: generateRandomSecret(32) })}
                >
                  <Shield className="h-4 w-4" />
                  Gerar ENCRYPTION_KEY
                </button>
              </div>
              <label className="block space-y-1 text-sm">
                <span className="text-muted">SESSION_SECRET</span>
                <input
                  className="w-full rounded-card border bg-white px-3 py-2 font-mono text-xs"
                  value={draft.sessionSecret}
                  onChange={(e) => patch({ sessionSecret: e.target.value })}
                />
              </label>
              <label className="block space-y-1 text-sm">
                <span className="text-muted">CREDENTIALS_ENCRYPTION_KEY</span>
                <input
                  className="w-full rounded-card border bg-white px-3 py-2 font-mono text-xs"
                  value={draft.encryptionKey}
                  onChange={(e) => patch({ encryptionKey: e.target.value })}
                />
              </label>
              <label className="block space-y-1 text-sm">
                <span className="text-muted">E-mail admin (seed)</span>
                <input
                  className="w-full rounded-card border bg-white px-3 py-2 text-sm"
                  value={draft.adminEmail}
                  onChange={(e) => patch({ adminEmail: e.target.value })}
                />
              </label>
              <label className="block space-y-1 text-sm">
                <span className="text-muted">Senha admin (seed)</span>
                <input
                  type="password"
                  className="w-full rounded-card border bg-white px-3 py-2 text-sm"
                  value={draft.adminPassword}
                  onChange={(e) => patch({ adminPassword: e.target.value })}
                />
              </label>
              <label className="block space-y-1 text-sm">
                <span className="text-muted">Repositório GitHub (org/repo)</span>
                <input
                  className="w-full rounded-card border bg-white px-3 py-2 font-mono text-sm"
                  value={draft.githubRepo}
                  onChange={(e) => patch({ githubRepo: e.target.value })}
                />
              </label>
            </>
          ) : null}

          {step.id === "review" ? (
            <>
              <h2 className="text-xl font-semibold text-ink">Resumo e arquivos</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-card bg-white/70 p-3 text-sm">
                  <p className="text-muted">Painel</p>
                  <p className="font-mono text-xs font-medium text-accent">{artifacts.webUrl}</p>
                </div>
                <div className="rounded-card bg-white/70 p-3 text-sm">
                  <p className="text-muted">API pública</p>
                  <p className="font-mono text-xs font-medium">{artifacts.publicApiUrl}</p>
                </div>
              </div>

              {artifacts.dnsRecords.length > 0 ? (
                <div className="rounded-card border border-white/70 p-3">
                  <p className="mb-2 text-sm font-medium">Registros DNS</p>
                  <table className="w-full text-xs">
                    <thead className="text-left text-muted">
                      <tr>
                        <th className="pb-1">Tipo</th>
                        <th className="pb-1">Nome</th>
                        <th className="pb-1">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {artifacts.dnsRecords.map((r, i) => (
                        <tr key={i} className="border-t border-white/60">
                          <td className="py-1">{r.type}</td>
                          <td className="py-1 font-mono">{r.name}</td>
                          <td className="py-1 font-mono">{r.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {artifacts.notes.length > 0 ? (
                <ul className="list-inside list-disc space-y-1 text-xs text-muted">
                  {artifacts.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              ) : null}

              <CopyBlock label=".env (raiz do projeto)" content={artifacts.envRoot} />
              <CopyBlock label="apps/web/.env.local" content={artifacts.envWeb} />
              <CopyBlock label="Comandos de instalação" content={artifacts.installCommands} />

              {draft.proxyEngine === "nginx" && artifacts.nginxConfig ? (
                <CopyBlock label="/etc/nginx/sites-available/opspanel.conf" content={artifacts.nginxConfig} />
              ) : null}

              {draft.proxyEngine === "caddy" && artifacts.caddyConfig ? (
                <CopyBlock label="Caddyfile" content={artifacts.caddyConfig} />
              ) : null}

              <a
                href={`data:text/plain;charset=utf-8,${encodeURIComponent(artifacts.envRoot)}`}
                download="opspanel.env"
                className="inline-flex items-center gap-2 rounded-card bg-accent px-4 py-2.5 text-sm font-medium text-white"
              >
                <Download className="h-4 w-4" />
                Baixar .env
              </a>
            </>
          ) : null}

          {error ? <p className="rounded-card bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p> : null}

          <div className="flex justify-between border-t border-white/60 pt-4">
            <button
              type="button"
              disabled={stepIndex === 0}
              onClick={back}
              className="rounded-card border border-white/80 px-4 py-2 text-sm text-muted disabled:opacity-40"
            >
              Voltar
            </button>
            {stepIndex < INSTALL_STEPS.length - 1 ? (
              <button
                type="button"
                onClick={next}
                className="inline-flex items-center gap-1 rounded-card bg-accent px-4 py-2 text-sm font-medium text-white"
              >
                Continuar
                <ArrowRight className="h-4 w-4" />
              </button>
            ) : (
              <Link
                href={panelUrl("/login")}
                className="inline-flex items-center gap-1 rounded-card bg-success px-4 py-2 text-sm font-medium text-white"
              >
                Ir para login
                <ArrowRight className="h-4 w-4" />
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
