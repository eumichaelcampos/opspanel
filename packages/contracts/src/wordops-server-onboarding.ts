/**
 * Wizard de provisionamento WordOps no servidor.
 * Baseado no fluxo de alta performance (Michael Campos / WordOps docs).
 * Criação de sites fica em Sites (último passo do wizard apenas orienta).
 */

import type { StackComponentState } from "./wordops-server-catalog.js";
import { WORDOPS_STACK_COMPONENTS } from "./wordops-server-catalog.js";

export type OnboardingStepId =
  | "connect"
  | "system_update"
  | "wordops_install"
  | "stack_install"
  | "mariadb_migrate"
  | "stack_verify"
  | "security_stack"
  | "ufw_ports"
  | "monitoring"
  | "sync_inventory"
  | "ready";

export type OnboardingStepStatus = "pending" | "running" | "done" | "skipped" | "blocked";

export type OnboardingOperation =
  | "test-connection"
  | "system-update"
  | "maintenance"
  | "wordops-install"
  | "stack-install-web"
  | "stack-migrate-mariadb"
  | "stack-status"
  | "stack-install-security"
  | "ufw-configure"
  | "stack-install-monitoring"
  | "sync-inventory"
  | "none";

export interface ServerOnboardingStepDef {
  id: OnboardingStepId;
  label: string;
  description: string;
  woCommand?: string;
  operation: OnboardingOperation;
  required: boolean;
  /** Passos opcionais podem ser reordenados via drag-and-drop */
  reorderable: boolean;
  estimatedMinutes?: number;
}

export const SERVER_ONBOARDING_STEPS: ServerOnboardingStepDef[] = [
  {
    id: "connect",
    label: "Conectar SSH",
    description: "Valida credenciais, OS e conectividade com o servidor.",
    operation: "test-connection",
    required: true,
    reorderable: false,
    estimatedMinutes: 1,
  },
  {
    id: "system_update",
    label: "Atualizar Ubuntu/Debian",
    description:
      "Atualiza pacotes do sistema com apt antes de instalar o WordOps (WordOps ainda não está disponível nesta etapa).",
    woCommand: "apt update -y && apt upgrade -y",
    operation: "system-update",
    required: true,
    reorderable: false,
    estimatedMinutes: 5,
  },
  {
    id: "wordops_install",
    label: "Instalar WordOps",
    description: "Baixa e instala a CLI WordOps (wops.cc) no servidor virgem.",
    woCommand: "wget -qO wo wops.cc && bash wo install --force",
    operation: "wordops-install",
    required: true,
    reorderable: false,
    estimatedMinutes: 8,
  },
  {
    id: "stack_install",
    label: "Stack LEMP (web)",
    description: "Nginx, PHP, MariaDB, WP-CLI e Redis (wo stack install --web).",
    woCommand: "wo stack install --web --force",
    operation: "stack-install-web",
    required: true,
    reorderable: false,
    estimatedMinutes: 10,
  },
  {
    id: "mariadb_migrate",
    label: "Migrar para MariaDB",
    description: "Garante MariaDB como backend de banco (wo stack migrate --mariadb).",
    woCommand: "wo stack migrate --mariadb --force",
    operation: "stack-migrate-mariadb",
    required: true,
    reorderable: false,
    estimatedMinutes: 3,
  },
  {
    id: "stack_verify",
    label: "Verificar stack",
    description: "Confirma nginx, PHP e MariaDB ativos (wo stack status).",
    woCommand: "wo stack status --all",
    operation: "stack-status",
    required: true,
    reorderable: false,
    estimatedMinutes: 1,
  },
  {
    id: "security_stack",
    label: "Segurança",
    description: "Fail2ban, Nginx Bad Bot Blocker e UFW.",
    woCommand: "wo stack install --fail2ban --ngxblocker --ufw --force",
    operation: "stack-install-security",
    required: true,
    reorderable: true,
    estimatedMinutes: 4,
  },
  {
    id: "ufw_ports",
    label: "Firewall (portas)",
    description: "Libera SSH (porta do servidor + 22), HTTP(80), HTTPS(443) e painel WordOps(22222).",
    woCommand: "ufw allow 22,80,443,22222/tcp && ufw enable",
    operation: "ufw-configure",
    required: true,
    reorderable: true,
    estimatedMinutes: 1,
  },
  {
    id: "monitoring",
    label: "Monitoramento",
    description: "Netdata + WordOps Dashboard (:22222) para métricas ao vivo.",
    woCommand: "wo stack install --netdata --dashboard --force",
    operation: "stack-install-monitoring",
    required: false,
    reorderable: true,
    estimatedMinutes: 3,
  },
  {
    id: "sync_inventory",
    label: "Inventariar sites",
    description: "Sincroniza lista de sites existentes (wo site list).",
    woCommand: "wo site list",
    operation: "sync-inventory",
    required: true,
    reorderable: false,
    estimatedMinutes: 1,
  },
  {
    id: "ready",
    label: "Servidor pronto",
    description: "Provisionamento concluído. Crie sites em Sites → Novo site.",
    operation: "none",
    required: true,
    reorderable: false,
  },
];

export interface OnboardingSnapshot {
  completedSteps?: OnboardingStepId[];
  skippedSteps?: OnboardingStepId[];
  stepOrder?: OnboardingStepId[];
  lastStepId?: OnboardingStepId;
}

export interface ServerOnboardingContext {
  credentialConfigured: boolean;
  status: string;
  lastConnectedAt?: string | null;
  wordopsVersion?: string | null;
  lastSyncedAt?: string | null;
  siteCount?: number;
  stackComponents?: StackComponentState[];
  onboardingSnapshot?: OnboardingSnapshot | null;
  onboardingCompletedAt?: string | null;
}

export interface ResolvedOnboardingStep {
  id: OnboardingStepId;
  label: string;
  description: string;
  woCommand?: string;
  operation: OnboardingOperation;
  required: boolean;
  reorderable: boolean;
  estimatedMinutes?: number;
  status: OnboardingStepStatus;
}

function componentInstalled(components: StackComponentState[] | undefined, id: string): boolean {
  return Boolean(components?.find((c) => c.id === id)?.installed);
}

function componentRunning(components: StackComponentState[] | undefined, id: string): boolean {
  const c = components?.find((x) => x.id === id);
  return Boolean(c?.installed && c?.running);
}

const WEB_STACK_IDS = new Set(["nginx", "mysql", "redis", "php74", "php80", "php81", "php82", "php83", "php84"]);

/** Servidor já tinha WordOps antes do wizard (não está instalando do zero). */
export function isExistingWordOpsServer(ctx: ServerOnboardingContext): boolean {
  if (!ctx.wordopsVersion) return false;
  if (ctx.onboardingCompletedAt) return true;
  if (ctx.lastSyncedAt) return true;
  if ((ctx.siteCount ?? 0) > 0) return true;

  const components = ctx.stackComponents;
  if (!components?.length) return false;

  if (componentInstalled(components, "nginx") && componentInstalled(components, "mysql")) {
    return true;
  }

  return components.some((c) => c.installed && WEB_STACK_IDS.has(c.id));
}

export function isStepDone(ctx: ServerOnboardingContext, stepId: OnboardingStepId): boolean {
  const snap = ctx.onboardingSnapshot;
  if (snap?.completedSteps?.includes(stepId)) return true;
  if (snap?.skippedSteps?.includes(stepId)) return true;

  const components = ctx.stackComponents;
  const existing = isExistingWordOpsServer(ctx);

  switch (stepId) {
    case "connect":
      return ctx.credentialConfigured && Boolean(ctx.lastConnectedAt) && ctx.status !== "pending" && ctx.status !== "offline";
    case "system_update":
      return Boolean(snap?.completedSteps?.includes("system_update")) || existing;
    case "wordops_install":
      return Boolean(ctx.wordopsVersion) || Boolean(snap?.completedSteps?.includes("wordops_install"));
    case "stack_install":
      return (
        Boolean(snap?.completedSteps?.includes("stack_install")) ||
        (componentInstalled(components, "nginx") && componentInstalled(components, "mysql")) ||
        (existing && componentInstalled(components, "nginx"))
      );
    case "mariadb_migrate":
      return (
        Boolean(snap?.completedSteps?.includes("mariadb_migrate")) ||
        componentRunning(components, "mysql") ||
        (existing && componentInstalled(components, "mysql"))
      );
    case "stack_verify":
      return (
        Boolean(snap?.completedSteps?.includes("stack_verify")) ||
        (componentRunning(components, "nginx") && componentRunning(components, "mysql")) ||
        (existing && componentInstalled(components, "nginx") && componentInstalled(components, "mysql"))
      );
    case "security_stack": {
      const fullSecurity =
        componentInstalled(components, "fail2ban") &&
        componentInstalled(components, "ngxblocker") &&
        componentInstalled(components, "ufw");
      if (fullSecurity) return true;
      if (existing && componentInstalled(components, "nginx")) {
        return (
          componentInstalled(components, "fail2ban") ||
          componentInstalled(components, "ngxblocker") ||
          componentInstalled(components, "ufw")
        );
      }
      return false;
    }
    case "ufw_ports":
      return (
        Boolean(snap?.completedSteps?.includes("ufw_ports")) ||
        componentInstalled(components, "ufw") ||
        existing
      );
    case "monitoring":
      return componentInstalled(components, "netdata") || Boolean(snap?.skippedSteps?.includes("monitoring"));
    case "sync_inventory":
      return Boolean(ctx.lastSyncedAt) || (existing && (ctx.siteCount ?? 0) > 0);
    case "ready":
      if (ctx.onboardingCompletedAt) return true;
      if (existing) {
        return (
          isStepDone(ctx, "connect") &&
          isStepDone(ctx, "wordops_install") &&
          isStepDone(ctx, "stack_install") &&
          isStepDone(ctx, "stack_verify") &&
          isStepDone(ctx, "sync_inventory")
        );
      }
      return (
        isStepDone(ctx, "connect") &&
        isStepDone(ctx, "wordops_install") &&
        isStepDone(ctx, "stack_install") &&
        isStepDone(ctx, "stack_verify") &&
        isStepDone(ctx, "security_stack") &&
        isStepDone(ctx, "sync_inventory")
      );
    default:
      return false;
  }
}

export function resolveOnboardingSteps(
  ctx: ServerOnboardingContext,
  activeStepId?: OnboardingStepId | null,
): ResolvedOnboardingStep[] {
  const order = ctx.onboardingSnapshot?.stepOrder;
  const defs = [...SERVER_ONBOARDING_STEPS];
  const sorted = order?.length
    ? [
        ...defs.filter((s) => !s.reorderable),
        ...order
          .map((id) => defs.find((d) => d.id === id))
          .filter((d): d is ServerOnboardingStepDef => Boolean(d)),
        ...defs.filter((s) => s.reorderable && !order.includes(s.id)),
      ]
    : defs;

  const seen = new Set<string>();
  const unique = sorted.filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });

  return unique.map((def) => {
    let status: OnboardingStepStatus = "pending";
    if (activeStepId === def.id) status = "running";
    else if (isStepDone(ctx, def.id)) status = ctx.onboardingSnapshot?.skippedSteps?.includes(def.id) ? "skipped" : "done";
    else if (def.id === "ready") {
      status = isStepDone(ctx, "ready") ? "done" : "blocked";
    } else {
      const prevRequired = unique.filter((s) => s.required && s.id !== def.id);
      const idx = unique.findIndex((s) => s.id === def.id);
      const blockers = prevRequired.filter((s, i) => unique.indexOf(s) < idx && !isStepDone(ctx, s.id));
      if (blockers.length > 0 && def.id !== "connect") status = "blocked";
    }

    return { ...def, status };
  });
}

export function onboardingProgress(steps: ResolvedOnboardingStep[]): number {
  const actionable = steps.filter((s) => s.id !== "ready");
  if (!actionable.length) return 0;
  const done = actionable.filter((s) => s.status === "done" || s.status === "skipped").length;
  return Math.round((done / actionable.length) * 100);
}

export function serverNeedsOnboarding(ctx: ServerOnboardingContext): boolean {
  if (ctx.onboardingCompletedAt) return false;
  if (isExistingWordOpsServer(ctx)) return false;
  return !isStepDone(ctx, "ready");
}

export interface StackInventoryItem {
  id: string;
  label: string;
  category: string;
  installed: boolean;
  running: boolean;
  status: string;
}

export interface ExistingServerInventory {
  wordopsVersion?: string | null;
  siteCount: number;
  lastSyncedAt?: string | null;
  installed: StackInventoryItem[];
  available: StackInventoryItem[];
  /** WordOps detectado, mas ainda sem inventário da stack (coletar saúde). */
  needsHealthScan: boolean;
}

export function resolveExistingServerInventory(ctx: ServerOnboardingContext): ExistingServerInventory {
  const stateMap = new Map((ctx.stackComponents ?? []).map((c) => [c.id, c]));
  const items: StackInventoryItem[] = WORDOPS_STACK_COMPONENTS.map((def) => {
    const state = stateMap.get(def.id);
    return {
      id: def.id,
      label: def.label,
      category: def.category,
      installed: Boolean(state?.installed),
      running: Boolean(state?.running),
      status: state?.status ?? "desconhecido",
    };
  });

  return {
    wordopsVersion: ctx.wordopsVersion,
    siteCount: ctx.siteCount ?? 0,
    lastSyncedAt: ctx.lastSyncedAt ?? null,
    installed: items.filter((i) => i.installed),
    available: items.filter((i) => !i.installed),
    needsHealthScan: Boolean(ctx.wordopsVersion) && !ctx.stackComponents?.length,
  };
}
