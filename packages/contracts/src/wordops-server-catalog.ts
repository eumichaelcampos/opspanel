/**
 * Catálogo WordOps mapeado da documentação:
 * https://docs.wordops.net/commands/stack/
 * https://docs.wordops.net/commands/maintenance/
 */

export const WORDOPS_STACK_GROUPS = [
  { id: "web", label: "Stack", flag: "--web", desc: "Nginx, PHP, MariaDB, WP-CLI (stack base)" },
  { id: "admin", label: "Admin", flag: "--admin", desc: "phpMyAdmin, Adminer, Dashboard, Netdata, MySQLTuner" },
  { id: "utils", label: "Utils", flag: "--utils", desc: "OpcacheGUI, Webgrind, Anemometer" },
] as const;

export const WORDOPS_STACK_COMPONENTS = [
  { id: "nginx", label: "Nginx", flag: "--nginx", category: "web" },
  { id: "php", label: "PHP (padrão)", flag: "--php", category: "web" },
  { id: "php74", label: "PHP 7.4", flag: "--php74", category: "web" },
  { id: "php80", label: "PHP 8.0", flag: "--php80", category: "web" },
  { id: "php81", label: "PHP 8.1", flag: "--php81", category: "web" },
  { id: "php82", label: "PHP 8.2", flag: "--php82", category: "web" },
  { id: "php83", label: "PHP 8.3", flag: "--php83", category: "web" },
  { id: "php84", label: "PHP 8.4", flag: "--php84", category: "web" },
  { id: "mysql", label: "MariaDB", flag: "--mysql", category: "web" },
  { id: "redis", label: "Redis", flag: "--redis", category: "web" },
  { id: "wpcli", label: "WP-CLI", flag: "--wpcli", category: "web" },
  { id: "phpmyadmin", label: "phpMyAdmin", flag: "--phpmyadmin", category: "admin" },
  { id: "adminer", label: "Adminer", flag: "--adminer", category: "admin" },
  { id: "netdata", label: "Netdata", flag: "--netdata", category: "admin" },
  { id: "dashboard", label: "WordOps Dashboard", flag: "--dashboard", category: "admin" },
  { id: "composer", label: "Composer", flag: "--composer", category: "admin" },
  { id: "mysqltuner", label: "MySQLTuner", flag: "--mysqltuner", category: "admin" },
  { id: "proftpd", label: "ProFTPd", flag: "--proftpd", category: "admin" },
  { id: "fail2ban", label: "Fail2ban", flag: "--fail2ban", category: "security" },
  { id: "ngxblocker", label: "Nginx Bad Bot Blocker", flag: "--ngxblocker", category: "security" },
  { id: "ufw", label: "UFW Firewall", flag: "--ufw", category: "security" },
  { id: "brotli", label: "Brotli (Nginx)", flag: "--brotli", category: "web" },
  { id: "sendmail", label: "Sendmail", flag: "--sendmail", category: "web" },
] as const;

export const WORDOPS_STACK_ACTIONS = [
  { id: "install", label: "Instalar", wo: "wo stack install", destructive: false },
  { id: "upgrade", label: "Atualizar", wo: "wo stack upgrade", destructive: false },
  { id: "restart", label: "Reiniciar", wo: "wo stack restart", destructive: false },
  { id: "reload", label: "Recarregar", wo: "wo stack reload", destructive: false },
  { id: "start", label: "Iniciar", wo: "wo stack start", destructive: false },
  { id: "stop", label: "Parar", wo: "wo stack stop", destructive: false },
  { id: "status", label: "Status", wo: "wo stack status", destructive: false },
  { id: "remove", label: "Remover", wo: "wo stack remove", destructive: true },
  { id: "purge", label: "Remover e purgar", wo: "wo stack purge", destructive: true },
] as const;

export const WORDOPS_SERVER_QUICK_ACTIONS = [
  { id: "maintenance", label: "Manutenção APT", desc: "apt update, dist-upgrade, autoremove (wo maintenance)", wo: "wo maintenance" },
  { id: "stack_status", label: "Status da stack", desc: "Verifica serviços WordOps", wo: "wo stack status", components: ["all"] as const, action: "status" as const },
  { id: "install_security", label: "Instalar segurança", desc: "Fail2ban + ngxblocker + UFW", components: ["fail2ban", "ngxblocker", "ufw"] as const, action: "install" as const },
  { id: "install_proftpd", label: "Instalar ProFTPd", desc: "Servidor FTP para sites", components: ["proftpd"] as const, action: "install" as const },
  { id: "upgrade_all", label: "Upgrade stack completa", desc: "Atualiza todos os pacotes WordOps", components: ["all"] as const, action: "upgrade" as const },
] as const;

/** Controles da máquina (servidor físico/VPS). */
export const WORDOPS_SERVER_MACHINE_CONTROLS = [
  {
    id: "stack_restart",
    label: "Reiniciar stack WordOps",
    desc: "Reinicia nginx, PHP, MariaDB e demais serviços (wo stack restart --all)",
    wo: "wo stack restart --all --force",
    destructive: false,
    operation: "stack-restart" as const,
  },
  {
    id: "stack_reload",
    label: "Recarregar nginx",
    desc: "Aplica configurações sem derrubar conexões (wo stack reload --nginx)",
    wo: "wo stack reload --nginx --force",
    destructive: false,
    operation: "stack-action" as const,
    components: ["nginx"] as const,
    action: "reload" as const,
  },
  {
    id: "reboot",
    label: "Reiniciar servidor",
    desc: "Reinicia a máquina em 1 minuto. Conexões SSH serão encerradas.",
    wo: "shutdown -r +1",
    destructive: true,
    operation: "reboot" as const,
  },
] as const;

export type WordOpsStackComponentId = (typeof WORDOPS_STACK_COMPONENTS)[number]["id"] | "all";
export type WordOpsStackActionId = (typeof WORDOPS_STACK_ACTIONS)[number]["id"];

export interface StackComponentState {
  id: string;
  installed: boolean;
  running: boolean;
  status: string;
  serviceName?: string;
}

export interface ServerHealthSnapshot {
  uptimeSeconds?: number;
  loadAvg?: [number, number, number];
  memoryTotalMb?: number;
  memoryUsedMb?: number;
  memoryUsedPct?: number;
  diskTotalGb?: number;
  diskUsedGb?: number;
  diskUsedPct?: number;
  cpuCount?: number;
  topProcesses?: { pid: string; cpu: string; mem: string; command: string }[];
  stackServices?: { name: string; status: string }[];
  stackComponents?: StackComponentState[];
  rawStackStatus?: string;
  collectedAt?: string;
}
