"use client";

import type {
  SiteCreationDraft,
  SiteCreationStepId,
  WordOpsPhpVersionId,
  WordOpsSiteTypeId,
  WordOpsSslModeId,
} from "@opspanel/contracts";
import {
  DEFAULT_SITE_CREATION_DRAFT,
  SSL_MODE_FRIENDLY,
  WPROCKET_LICENSE_NOTICE,
  buildSiteCreateCommandPreview,
  buildSiteCreatePayload,
  buildSiteCreationSummary,
  getExtraFlagOptions,
  getSiteTypeOptionsForWizard,
  getVisibleSiteCreationSteps,
  getWpRocketPurchaseWhatsAppUrl,
  isWordPressSiteType,
  siteCreationProgress,
  sslModeNeedsCloudflare,
  validateSiteCreationStep,
} from "@opspanel/contracts";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Globe,
  Loader2,
  Lock,
  Rocket,
  Shield,
  Sparkles,
  Star,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type CreateOptions = {
  phpVersions: { id: string; label: string; flag: string | null; available?: boolean; installed?: boolean }[];
  multisite: { id: string; label: string; flags: string[] }[];
  docsUrl: string;
  installedPhpVersions?: string[];
  preferredPhpVersion?: string;
  serverStackKnown?: boolean;
  serverName?: string;
  healthObservedAt?: string | null;
};

type ServerRow = { id: string; name: string; host: string; status: string; wordopsVersion?: string | null };

type Props = {
  presetServerId?: string;
  servers: ServerRow[];
  onJobStarted: (jobId: string) => void;
};

function WpRocketNotice({ compact }: { compact?: boolean }) {
  const url = getWpRocketPurchaseWhatsAppUrl();
  return (
    <div
      className={cn(
        "rounded-card border border-amber-200/80 bg-amber-50/90 text-sm text-amber-950",
        compact ? "px-3 py-2" : "px-4 py-3",
      )}
    >
      <p>{WPROCKET_LICENSE_NOTICE}</p>
      <p className={cn("text-amber-900", compact ? "mt-1.5 text-xs" : "mt-2")}>
        Quer adquirir a licença?{" "}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-accent underline underline-offset-2 hover:opacity-90"
        >
          Fale conosco no WhatsApp
        </a>
        .
      </p>
    </div>
  );
}

function stepIcon(id: SiteCreationStepId) {
  switch (id) {
    case "where":
      return Globe;
    case "kind":
      return Sparkles;
    case "wordpress":
      return Star;
    case "destination":
      return ArrowRight;
    case "security":
      return Lock;
    case "extras":
      return Shield;
    case "review":
      return Rocket;
    default:
      return Globe;
  }
}

export function SiteCreationWizard({ presetServerId, servers, onJobStarted }: Props) {
  const [draft, setDraft] = useState<SiteCreationDraft>({
    ...DEFAULT_SITE_CREATION_DRAFT,
    serverId: presetServerId ?? "",
  });
  const [stepIndex, setStepIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data: options } = useQuery({
    queryKey: ["sites-create-options", draft.serverId],
    queryFn: () =>
      apiFetch<CreateOptions>(
        `/sites/create-options${draft.serverId ? `?serverId=${encodeURIComponent(draft.serverId)}` : ""}`,
      ),
    enabled: Boolean(draft.serverId),
  });

  useEffect(() => {
    if (!options?.preferredPhpVersion || !options.serverStackKnown) return;
    setDraft((prev) => {
      const current = options.phpVersions.find((p) => p.id === prev.phpVersion);
      if (current?.available !== false) return prev;
      return { ...prev, phpVersion: options.preferredPhpVersion as WordOpsPhpVersionId };
    });
  }, [options?.preferredPhpVersion, options?.serverStackKnown, options?.phpVersions]);

  const visibleSteps = useMemo(() => getVisibleSiteCreationSteps(draft), [draft]);
  const currentStep = visibleSteps[stepIndex];

  useEffect(() => {
    setStepIndex((i) => Math.min(i, Math.max(visibleSteps.length - 1, 0)));
  }, [visibleSteps.length]);
  const progress = currentStep ? siteCreationProgress(currentStep.id, draft) : 0;
  const isLastStep = stepIndex === visibleSteps.length - 1;
  const isFirstStep = stepIndex === 0;

  const readyServers = servers.filter((s) => s.status === "healthy" || s.wordopsVersion);
  const selectedServer = servers.find((s) => s.id === draft.serverId);
  const siteTypeOptions = getSiteTypeOptionsForWizard();
  const extraFlags = getExtraFlagOptions();

  function patch(partial: Partial<SiteCreationDraft>) {
    setDraft((prev) => ({ ...prev, ...partial }));
    setError(null);
  }

  function goNext() {
    if (!currentStep) return;
    const validation = validateSiteCreationStep(currentStep.id, draft);
    if (!validation.ok) {
      setError(validation.message ?? "Preencha os campos obrigatórios.");
      return;
    }
    setError(null);
    if (isLastStep) {
      void submit();
      return;
    }
    setStepIndex((i) => Math.min(i + 1, visibleSteps.length - 1));
  }

  function goBack() {
    setError(null);
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const result = await apiFetch<{ jobId: string }>("/sites", {
        method: "POST",
        body: JSON.stringify(buildSiteCreatePayload(draft)),
      });
      onJobStarted(result.jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar o site.");
    } finally {
      setSubmitting(false);
    }
  }

  const summary = buildSiteCreationSummary(draft, selectedServer?.name);
  const commandPreview = buildSiteCreateCommandPreview(draft);

  if (!currentStep) return null;

  const StepIcon = stepIcon(currentStep.id);

  return (
    <div className="wizard-enter mx-auto max-w-3xl space-y-6">
      <div className="rounded-shell border border-accent/20 bg-gradient-to-br from-accent/5 via-white/60 to-white/40 p-6 shadow-glass">
        <div className="flex items-start gap-3">
          <StepIcon className="mt-0.5 h-6 w-6 shrink-0 text-accent" />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              Passo {stepIndex + 1} de {visibleSteps.length}
            </p>
            <h2 className="text-lg font-semibold text-ink">{currentStep.label}</h2>
            <p className="text-sm text-muted">{currentStep.description}</p>
            {currentStep.helpText ? (
              <p className="text-xs text-muted/90">{currentStep.helpText}</p>
            ) : null}
          </div>
        </div>

        <div className="mt-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>Progresso</span>
            <span>{progress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/80">
            <div
              className="h-full rounded-full bg-gradient-to-r from-accent to-accent/70 transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <ol className="flex flex-wrap gap-1 pt-1">
            {visibleSteps.map((step, i) => (
              <li
                key={step.id}
                className={cn(
                  "h-1.5 flex-1 min-w-[2rem] rounded-full transition-colors",
                  i < stepIndex ? "bg-success" : i === stepIndex ? "bg-accent" : "bg-white/80",
                )}
              />
            ))}
          </ol>
        </div>
      </div>

      {error ? <p className="rounded-card bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p> : null}

      <div className="rounded-shell border border-white/80 bg-white/90 p-6 shadow-sm">
        {currentStep.id === "where" ? (
          <div className="space-y-4">
            <label className="block space-y-2 text-sm">
              <span className="font-medium text-ink">Em qual servidor?</span>
              <select
                className="w-full rounded-card border border-ink/20 bg-white px-3 py-2.5 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
                value={draft.serverId}
                onChange={(e) => patch({ serverId: e.target.value })}
              >
                <option value="">Selecione o servidor...</option>
                {(readyServers.length ? readyServers : servers).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.host})
                    {s.wordopsVersion ? ` · WordOps ${s.wordopsVersion}` : ""}
                  </option>
                ))}
              </select>
              {readyServers.length === 0 && servers.length > 0 ? (
                <p className="text-xs text-amber-700">
                  Nenhum servidor está marcado como pronto. Você ainda pode selecionar um, mas recomendamos concluir o
                  provisionamento antes.
                </p>
              ) : null}
            </label>
            <label className="block space-y-2 text-sm">
              <span className="font-medium text-ink">Qual o endereço do site?</span>
              <input
                className="w-full rounded-card border border-ink/20 bg-white px-3 py-2.5 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
                placeholder="minhaloja.com.br"
                value={draft.domain}
                onChange={(e) => patch({ domain: e.target.value })}
              />
              <p className="text-xs text-muted">Digite sem http:// ou www. Exemplo: minhaloja.com.br</p>
            </label>
          </div>
        ) : null}

        {currentStep.id === "kind" ? (
          <div className="space-y-5">
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-accent">Recomendado</p>
              {siteTypeOptions
                .filter((t) => t.group === "recommended")
                .map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => patch({ siteType: t.id as WordOpsSiteTypeId })}
                    className={cn(
                      "w-full rounded-card border px-4 py-4 text-left transition",
                      draft.siteType === t.id
                        ? "border-accent bg-accent/10 ring-2 ring-accent/20"
                        : "border-white/80 bg-white hover:border-accent/30",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Star className="h-4 w-4 text-accent" />
                      <p className="font-medium">{t.label}</p>
                    </div>
                    <p className="mt-1 text-sm text-muted">{t.desc}</p>
                    {t.id === "wprocket" && t.notice ? (
                      <p className="mt-2 text-xs text-amber-800">{t.notice}</p>
                    ) : null}
                  </button>
                ))}
              {draft.siteType === "wprocket" ? <WpRocketNotice /> : null}
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Outras opções WordPress</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {siteTypeOptions
                  .filter((t) => t.group === "wordpress")
                  .map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => patch({ siteType: t.id as WordOpsSiteTypeId })}
                      className={cn(
                        "rounded-card border px-3 py-3 text-left text-sm transition",
                        draft.siteType === t.id ? "border-accent bg-accent/10" : "border-white/80 hover:bg-white",
                      )}
                    >
                      <p className="font-medium">{t.label}</p>
                      <p className="text-xs text-muted">{t.desc}</p>
                    </button>
                  ))}
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Sites simples e avançados</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {siteTypeOptions
                  .filter((t) => t.group === "simple" || t.group === "advanced")
                  .map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => patch({ siteType: t.id as WordOpsSiteTypeId })}
                      className={cn(
                        "rounded-card border px-3 py-3 text-left text-sm transition",
                        draft.siteType === t.id ? "border-accent bg-accent/10" : "border-white/80 hover:bg-white",
                      )}
                    >
                      <p className="font-medium">{t.label}</p>
                      <p className="text-xs text-muted">{t.desc}</p>
                    </button>
                  ))}
              </div>
            </div>
          </div>
        ) : null}

        {currentStep.id === "wordpress" ? (
          <div className="space-y-4">
            <label className="block space-y-2 text-sm">
              <span className="font-medium text-ink">Nome de usuário do administrador</span>
              <input
                className="w-full rounded-card border border-ink/20 bg-white px-3 py-2.5 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
                value={draft.wpUser}
                onChange={(e) => patch({ wpUser: e.target.value })}
                placeholder="admin"
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-2 text-sm">
                <span className="font-medium text-ink">Senha (opcional)</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  className="w-full rounded-card border border-ink/20 bg-white px-3 py-2.5 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
                  value={draft.wpPass}
                  onChange={(e) => patch({ wpPass: e.target.value })}
                  placeholder="Deixe vazio para gerar automaticamente"
                />
              </label>
              <label className="block space-y-2 text-sm">
                <span className="font-medium text-ink">E-mail (opcional)</span>
                <input
                  className="w-full rounded-card border border-ink/20 bg-white px-3 py-2.5 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
                  value={draft.wpEmail}
                  onChange={(e) => patch({ wpEmail: e.target.value })}
                  placeholder="seu@email.com"
                />
              </label>
            </div>
            {options?.multisite && options.multisite.length > 1 ? (
              <label className="block space-y-2 text-sm">
                <span className="font-medium text-ink">Rede de sites (multisite)</span>
                <select
                  className="w-full rounded-card border border-ink/20 bg-white px-3 py-2.5 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
                  value={draft.multisite}
                  onChange={(e) => patch({ multisite: e.target.value as SiteCreationDraft["multisite"] })}
                >
                  {options.multisite.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        ) : null}

        {currentStep.id === "destination" ? (
          <div className="space-y-4">
            {draft.siteType === "proxy" ? (
              <label className="block space-y-2 text-sm">
                <span className="font-medium text-ink">Endereço interno da aplicação</span>
                <input
                  className="w-full rounded-card border border-ink/20 bg-white px-3 py-2.5 font-mono text-sm focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
                  value={draft.proxyTarget}
                  onChange={(e) => patch({ proxyTarget: e.target.value })}
                  placeholder="127.0.0.1:3000"
                />
                <p className="text-xs text-muted">O programa deve estar rodando nesta porta no servidor.</p>
              </label>
            ) : null}
            {draft.siteType === "alias" ? (
              <label className="block space-y-2 text-sm">
                <span className="font-medium text-ink">Redirecionar visitantes para</span>
                <input
                  className="w-full rounded-card border border-ink/20 bg-white px-3 py-2.5 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
                  value={draft.aliasTarget}
                  onChange={(e) => patch({ aliasTarget: e.target.value })}
                  placeholder="www.meusite.com.br"
                />
              </label>
            ) : null}
          </div>
        ) : null}

        {currentStep.id === "security" ? (
          <div className="space-y-4">
            {(Object.keys(SSL_MODE_FRIENDLY) as WordOpsSslModeId[]).map((id) => {
              const s = SSL_MODE_FRIENDLY[id];
              return (
                <label
                  key={id}
                  className={cn(
                    "flex cursor-pointer gap-3 rounded-card border px-4 py-4 transition",
                    draft.sslMode === id ? "border-accent bg-accent/5 ring-1 ring-accent/30" : "border-white/80",
                  )}
                >
                  <input
                    type="radio"
                    name="sslMode"
                    checked={draft.sslMode === id}
                    onChange={() => patch({ sslMode: id })}
                    className="mt-1 accent-accent"
                  />
                  <div>
                    <p className="font-medium">
                      {s.label}
                      {s.recommended ? (
                        <span className="ml-2 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] text-accent">
                          recomendado
                        </span>
                      ) : null}
                    </p>
                    <p className="text-sm text-muted">{s.desc}</p>
                  </div>
                </label>
              );
            })}

            {sslModeNeedsCloudflare(draft.sslMode) ? (
              <div className="space-y-3 rounded-card border border-amber-200/80 bg-amber-50/90 p-4">
                <p className="text-sm text-amber-950">
                  Para validar o cadeado pela Cloudflare, informe os dados da sua conta. Você encontra a Global API Key
                  no painel Cloudflare em Meu perfil → API Tokens.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1 text-sm">
                    <span className="text-muted">Chave de API Cloudflare</span>
                    <input
                      type="password"
                      className="w-full rounded-card border border-ink/20 bg-white px-3 py-2 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
                      value={draft.cfKey}
                      onChange={(e) => patch({ cfKey: e.target.value })}
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="text-muted">E-mail da conta Cloudflare</span>
                    <input
                      className="w-full rounded-card border border-ink/20 bg-white px-3 py-2 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
                      value={draft.cfEmail}
                      onChange={(e) => patch({ cfEmail: e.target.value })}
                    />
                  </label>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {currentStep.id === "extras" ? (
          <div className="space-y-5">
            <div className="space-y-2">
              <p className="text-sm font-medium text-ink">Versão do PHP</p>
              <p className="text-xs text-muted">
                {options?.serverStackKnown
                  ? `PHP instalados no servidor: ${options.installedPhpVersions?.length ? options.installedPhpVersions.map((v) => `8.${v}`).join(", ") : "nenhum detectado (escaneie a saúde do servidor)"}.`
                  : "Selecione um servidor para ver quais versões PHP estão disponíveis."}
              </p>
              <div className="flex flex-wrap gap-2">
                {(options?.phpVersions ?? []).map((p) => {
                  const unavailable = p.available === false;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={unavailable}
                      onClick={() => !unavailable && patch({ phpVersion: p.id as WordOpsPhpVersionId })}
                      className={cn(
                        "rounded-card border px-3 py-2 text-sm transition",
                        draft.phpVersion === p.id ? "border-accent bg-accent/10" : "border-white/80",
                        unavailable && "cursor-not-allowed opacity-40",
                        p.installed && draft.phpVersion !== p.id && "ring-1 ring-success/30",
                      )}
                      title={unavailable ? "Não instalado neste servidor" : p.installed ? "Instalado no servidor" : undefined}
                    >
                      {p.label}
                      {p.installed ? " ✓" : null}
                    </button>
                  );
                })}
              </div>
              {options?.serverStackKnown && draft.phpVersion !== options.preferredPhpVersion && options.preferredPhpVersion ? (
                <p className="text-xs text-amber-800">
                  PHP {draft.phpVersion === "default" ? "padrão" : `8.${draft.phpVersion}`} pode não estar no servidor.
                  Recomendado: PHP 8.{options.preferredPhpVersion}.
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-ink">Opções extras</p>
              <div className="space-y-2">
                {extraFlags.map((f) => {
                  const disabled = f.id === "hsts" && draft.sslMode === "none";
                  const checked =
                    f.id === "hsts" ? draft.hsts : f.id === "ngxblocker" ? draft.ngxblocker : draft.vhostOnly;
                  return (
                    <label
                      key={f.id}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-card border px-3 py-3 text-sm",
                        disabled && "opacity-50",
                      )}
                    >
                      <input
                        type="checkbox"
                        disabled={disabled}
                        checked={checked}
                        onChange={(e) => {
                          if (f.id === "hsts") patch({ hsts: e.target.checked });
                          else if (f.id === "ngxblocker") patch({ ngxblocker: e.target.checked });
                          else patch({ vhostOnly: e.target.checked });
                        }}
                        className="mt-0.5 accent-accent"
                      />
                      <div>
                        <p className="font-medium">{f.friendlyLabel}</p>
                        <p className="text-xs text-muted">{f.desc}</p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}

        {currentStep.id === "review" ? (
          <div className="space-y-4">
            {draft.siteType === "wprocket" ? <WpRocketNotice compact /> : null}
            <div className="rounded-card border border-success/30 bg-success/5 p-4">
              <div className="flex items-center gap-2 text-success">
                <CheckCircle2 className="h-5 w-5" />
                <p className="font-medium">Tudo pronto para publicar</p>
              </div>
              <p className="mt-1 text-sm text-muted">
                Vamos criar o site no servidor. Isso pode levar alguns minutos.
              </p>
            </div>
            <dl className="divide-y divide-white/80 rounded-card border border-white/80">
              {summary.map((row) => (
                <div key={row.label} className="flex flex-wrap justify-between gap-2 px-4 py-3 text-sm">
                  <dt className="text-muted">{row.label}</dt>
                  <dd className="font-medium text-ink text-right">{row.value}</dd>
                </div>
              ))}
            </dl>
            <details className="text-xs text-muted">
              <summary className="cursor-pointer font-medium text-ink/70">Ver comando técnico (avançado)</summary>
              <code className="mt-2 block overflow-x-auto rounded bg-black/5 p-3 font-mono">{commandPreview}</code>
            </details>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={goBack}
          disabled={isFirstStep || submitting}
          className="flex items-center gap-1.5 rounded-card border border-white/80 bg-white/90 px-4 py-2.5 text-sm disabled:opacity-40"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </button>

        <div className="flex gap-2">
          {currentStep.optional ? (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setStepIndex((i) => Math.min(i + 1, visibleSteps.length - 1));
              }}
              disabled={submitting}
              className="rounded-card border border-white/80 px-4 py-2.5 text-sm text-muted"
            >
              Usar padrões
            </button>
          ) : null}
          <button
            type="button"
            onClick={goNext}
            disabled={submitting}
            className="flex items-center gap-1.5 rounded-card bg-accent px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:opacity-95 disabled:opacity-60"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Criando...
              </>
            ) : isLastStep ? (
              <>
                <Rocket className="h-4 w-4" />
                Publicar site
              </>
            ) : (
              <>
                Continuar
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </div>
      </div>

      {options?.docsUrl ? (
        <p className="text-center text-xs text-muted">
          Dúvidas? Consulte a{" "}
          <a href={options.docsUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
            documentação WordOps
          </a>
          .
        </p>
      ) : null}
    </div>
  );
}
