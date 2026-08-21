import { z } from "zod";

/** Passos tipados alinhados a OperationKeys (strings literais para evitar ciclo). */
export type PlaybookStepKind =
  | "server.stack.action"
  | "server.ufw.configure"
  | "server.security.scan"
  | "server.health.collect"
  | "server.metrics.collect"
  | "server.maintenance.run"
  | "server.system.update";

export type PlaybookStep = {
  id: string;
  label: string;
  operationKey: PlaybookStepKind;
  /** Para server.stack.action */
  stackAction?: "install" | "restart" | "upgrade" | "status";
  stackComponents?: string[];
  optional?: boolean;
};

export type PlaybookDefinition = {
  id: string;
  name: string;
  description: string;
  category: "hardening" | "cleanup" | "audit";
  estimatedMinutes: number;
  steps: PlaybookStep[];
};

export const PLAYBOOKS: PlaybookDefinition[] = [
  {
    id: "hardening",
    name: "Hardening",
    description: "Instala fail2ban, UFW e ngxblocker, configura firewall e roda scan de segurança.",
    category: "hardening",
    estimatedMinutes: 15,
    steps: [
      {
        id: "stack-security",
        label: "Instalar stack de segurança",
        operationKey: "server.stack.action",
        stackAction: "install",
        stackComponents: ["fail2ban", "ufw", "ngxblocker"],
      },
      {
        id: "ufw",
        label: "Configurar UFW",
        operationKey: "server.ufw.configure",
      },
      {
        id: "scan",
        label: "Scan de segurança",
        operationKey: "server.security.scan",
      },
    ],
  },
  {
    id: "cleanup",
    name: "Limpeza",
    description: "Manutenção WordOps (apt) e coleta de saúde para liberar espaço e atualizar pacotes.",
    category: "cleanup",
    estimatedMinutes: 20,
    steps: [
      {
        id: "maintenance",
        label: "Manutenção do sistema",
        operationKey: "server.maintenance.run",
      },
      {
        id: "health",
        label: "Coletar saúde",
        operationKey: "server.health.collect",
      },
    ],
  },
  {
    id: "audit",
    name: "Auditoria",
    description: "Coleta saúde, métricas e scan de segurança sem alterar a configuração.",
    category: "audit",
    estimatedMinutes: 8,
    steps: [
      {
        id: "health",
        label: "Coletar saúde",
        operationKey: "server.health.collect",
      },
      {
        id: "metrics",
        label: "Coletar métricas",
        operationKey: "server.metrics.collect",
      },
      {
        id: "scan",
        label: "Scan de segurança",
        operationKey: "server.security.scan",
      },
    ],
  },
];

export function getPlaybookById(id: string): PlaybookDefinition | undefined {
  return PLAYBOOKS.find((p) => p.id === id);
}

export const playbookRunInputSchema = z.object({
  serverId: z.string().uuid(),
});

export type PlaybookRunInput = z.infer<typeof playbookRunInputSchema>;

/** Input do job worker server.playbook.run */
export const serverPlaybookRunInputSchema = z.object({
  serverId: z.string().uuid(),
  playbookId: z.string().min(1).max(64),
});

export type ServerPlaybookRunInput = z.infer<typeof serverPlaybookRunInputSchema>;

export type PlaybookListResponse = {
  playbooks: PlaybookDefinition[];
};

export type PlaybookRunResponse = {
  jobId: string;
  playbookId: string;
  serverId: string;
};
