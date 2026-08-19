"use client";

import {
  Brackets,
  CheckCircle2,
  Cloud,
  Loader2,
  PauseCircle,
  PlayCircle,
  Rocket,
  ShieldCheck,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { isSiteManageActionActive, type SiteInfoSnapshot } from "@opspanel/contracts";
import { cn } from "@/lib/utils";
export type ManageAction = {
  id: string;
  label: string;
  wo: string;
  needsCloudflare?: boolean;
  destructive?: boolean;
};

type ActionMeta = {
  title: string;
  description: string;
  icon: LucideIcon;
  group: "availability" | "ssl" | "cache" | "php";
};

const ACTION_META: Record<string, ActionMeta> = {
  enable: {
    title: "Colocar site no ar",
    description: "Visitantes voltam a acessar o site normalmente.",
    icon: PlayCircle,
    group: "availability",
  },
  disable: {
    title: "Tirar site do ar",
    description: "O site fica indisponível até você reativar. Útil para manutenção.",
    icon: PauseCircle,
    group: "availability",
  },
  letsencrypt: {
    title: "Ativar HTTPS gratuito",
    description: "Instala o cadeado de segurança (Let's Encrypt) no navegador.",
    icon: ShieldCheck,
    group: "ssl",
  },
  letsencrypt_dns_cf: {
    title: "HTTPS com Cloudflare",
    description: "Certificado SSL validado pelo DNS do Cloudflare.",
    icon: Cloud,
    group: "ssl",
  },
  update_wpfc: {
    title: "Cache rápido (FastCGI)",
    description: "Acelera páginas WordPress com cache no servidor.",
    icon: Zap,
    group: "cache",
  },
  update_wpredis: {
    title: "Cache com Redis",
    description: "Melhora desempenho usando Redis para objetos do WordPress.",
    icon: Zap,
    group: "cache",
  },
  update_wprocket: {
    title: "WP Rocket",
    description: "Ativa o modo de cache otimizado para WP Rocket.",
    icon: Rocket,
    group: "cache",
  },
  update_wpsc: {
    title: "Super Cache",
    description: "Ativa o plugin WP Super Cache no site.",
    icon: Zap,
    group: "cache",
  },
  update_wpce: {
    title: "Cache Enabler",
    description: "Ativa cache estático leve com Cache Enabler.",
    icon: Zap,
    group: "cache",
  },
  update_php81: {
    title: "PHP 8.1",
    description: "Altera a versão do PHP que executa o site.",
    icon: Brackets,
    group: "php",
  },
  update_php82: {
    title: "PHP 8.2",
    description: "Altera a versão do PHP que executa o site.",
    icon: Brackets,
    group: "php",
  },
  update_php83: {
    title: "PHP 8.3",
    description: "Altera a versão do PHP que executa o site.",
    icon: Brackets,
    group: "php",
  },
  update_php84: {
    title: "PHP 8.4",
    description: "Altera a versão do PHP que executa o site.",
    icon: Brackets,
    group: "php",
  },
};

export function getManageActionTitle(actionId: string, fallback: string): string {
  return ACTION_META[actionId]?.title ?? fallback;
}

const GROUPS: { id: ActionMeta["group"]; title: string; hint: string }[] = [
  {
    id: "availability",
    title: "Disponibilidade",
    hint: "Ligue ou desligue o acesso público ao site.",
  },
  {
    id: "ssl",
    title: "Segurança (HTTPS)",
    hint: "Proteja o site com certificado SSL (cadeado no navegador).",
  },
  {
    id: "cache",
    title: "Velocidade",
    hint: "Opções de cache para sites WordPress. Escolha só se souber qual plugin usa.",
  },
  {
    id: "php",
    title: "Versão do PHP",
    hint: "Mude apenas se um plugin ou tema pedir outra versão.",
  },
];

function resolveMeta(action: ManageAction): ActionMeta {
  return (
    ACTION_META[action.id] ?? {
      title: action.label,
      description: "Aplica alteração no servidor via WordOps.",
      icon: Zap,
      group: "availability" as const,
    }
  );
}

type Props = {
  actions: ManageAction[];
  infoSnapshot?: SiteInfoSnapshot | null;
  disabled?: boolean;
  pendingActionId?: string | null;
  activeJobId?: string | null;
  onRun: (action: ManageAction) => void;
  error?: string | null;
};

export function SiteManagePanel({
  actions,
  infoSnapshot,
  disabled = false,
  pendingActionId,
  activeJobId,
  onRun,
  error,
}: Props) {  const grouped = GROUPS.map((group) => ({
    ...group,
    items: actions.filter((a) => resolveMeta(a).group === group.id),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-6">
      <div className="rounded-card border border-accent/20 bg-accent/5 px-4 py-3 text-sm text-muted">
        <p>
          Estas ações alteram configurações do site no servidor. Cada botão explica o que faz em linguagem simples.
          Se tiver dúvida, peça ajuda antes de mudar versão de PHP ou tipo de cache.
        </p>
      </div>

      {grouped.map((group) => (
        <section key={group.id} className="space-y-3">
          <div>
            <h3 className="text-base font-semibold text-ink">{group.title}</h3>
            <p className="text-xs text-muted">{group.hint}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {group.items.map((action) => {
              const meta = resolveMeta(action);
              const Icon = meta.icon;
              const running = pendingActionId === action.id && Boolean(activeJobId);
              const active = !running && isSiteManageActionActive(action.id, infoSnapshot);
              return (
                <button
                  key={action.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => onRun(action)}
                  className={cn(
                    "flex gap-3 rounded-card border px-4 py-3 text-left transition disabled:opacity-60",
                    running
                      ? "border-accent bg-accent/10 ring-1 ring-accent/30"
                      : active
                        ? "border-success/45 bg-success/10 ring-1 ring-success/20 hover:bg-success/15"
                        : action.destructive
                          ? "border-danger/40 bg-danger/5 hover:bg-danger/10"
                          : "border-white/80 bg-white/90 hover:border-accent/30 hover:bg-white",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                      running
                        ? "bg-accent/15 text-accent"
                        : active
                          ? "bg-success/15 text-success"
                          : "bg-ink/5 text-ink",
                    )}
                  >
                    {running ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : active ? (
                      <CheckCircle2 className="h-5 w-5" />
                    ) : (
                      <Icon className="h-5 w-5" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className={cn("block font-medium", active ? "text-success" : "text-ink")}>
                        {meta.title}
                      </span>
                      {active ? (
                        <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success">
                          Em uso
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-xs leading-snug text-muted">{meta.description}</span>
                    {action.needsCloudflare ? (
                      <span className="mt-1 inline-block text-[10px] font-medium uppercase tracking-wide text-accent">
                        Requer Cloudflare
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}          </div>
        </section>
      ))}

      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}
