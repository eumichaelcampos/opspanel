/** Staging Center: clone de sites e listagem de ambientes de staging. */

export type StagingHubSite = {
  siteId: string;
  domain: string;
  serverId: string;
  serverName?: string;
  siteType?: string | null;
  status: string;
  /** Domínio de origem do clone, se conhecido. */
  clonedFrom?: string | null;
  isStaging: boolean;
  isWordPress: boolean;
  createdAt?: string | null;
};

export type StagingCloneCandidate = {
  siteId: string;
  domain: string;
  serverId: string;
  serverName?: string;
  siteType?: string | null;
  suggestedTarget: string;
  isWordPress: boolean;
};

export type StagingHubResponse = {
  summary: {
    stagingSites: number;
    cloneCandidates: number;
  };
  stagingSites: StagingHubSite[];
  candidates: StagingCloneCandidate[];
};

/** Domínios que começam com staging. (ex.: staging.exemplo.com). */
export function isStagingDomain(domain: string): boolean {
  const d = domain.trim().toLowerCase();
  return d.startsWith("staging.");
}

/** Sugere staging.{domínio}. Se já for staging.*, usa clone.{resto}. */
export function suggestStagingDomain(domain: string): string {
  const d = domain.trim().toLowerCase();
  if (!d) return "";
  if (isStagingDomain(d)) {
    const rest = d.slice("staging.".length);
    return rest ? `clone.${rest}` : `clone.${d}`;
  }
  return `staging.${d}`;
}

export function stagingSiteLabel(site: Pick<StagingHubSite, "domain" | "isStaging" | "clonedFrom">): string {
  if (site.clonedFrom) return `Staging de ${site.clonedFrom}`;
  if (site.isStaging) return "Ambiente de staging";
  return site.domain;
}
