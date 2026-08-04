export const SYNC_INTERVALS = {
  /** Intervalo entre verificações de dados stale */
  checkMs: 30_000,
  /** Métricas Netdata/Nginx: atualiza com mais frequência */
  metricsStaleMs: 2 * 60_000,
  /** Saúde da stack e recursos do servidor */
  healthStaleMs: 10 * 60_000,
  /** Informações do site (wo site info) */
  siteInfoStaleMs: 10 * 60_000,
  /** Poll do GET enquanto a página está aberta */
  queryPollMs: 30_000,
} as const;

export function isObservedStale(observedAt: string | null | undefined, maxAgeMs: number): boolean {
  if (!observedAt) return true;
  return Date.now() - new Date(observedAt).getTime() > maxAgeMs;
}

export function formatObservedAt(observedAt?: string | null): string {
  if (!observedAt) return "aguardando primeira coleta…";
  return new Date(observedAt).toLocaleString("pt-BR");
}
