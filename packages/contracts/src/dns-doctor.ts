/** DNS Doctor: diagnóstico estruturado de apontamento e registros. */

export type DnsRecordKind = "A" | "AAAA" | "CNAME" | "MX" | "TXT";

export type DnsRecordStatus = "ok" | "warning" | "error" | "info" | "missing";

export type DnsDoctorRecord = {
  type: DnsRecordKind;
  name: string;
  values: string[];
  expected?: string[];
  status: DnsRecordStatus;
  detail: string;
};

export type DnsDoctorFix = {
  id: string;
  title: string;
  detail: string;
  priority: "high" | "medium" | "low";
  href?: string;
};

export type DnsTemplateId = "wordpress" | "email" | "redirect";

export type DnsTemplateSuggestion = {
  id: DnsTemplateId;
  title: string;
  summary: string;
  records: Array<{ type: DnsRecordKind; name: string; value: string; note?: string }>;
};

export type DnsDoctorVerdict =
  | "healthy"
  | "cloudflare_proxy"
  | "mispointed"
  | "no_records"
  | "partial"
  | "unknown";

export type DnsDoctorResult = {
  domain: string;
  serverId?: string;
  serverName?: string;
  serverHost: string;
  serverIps: string[];
  checkedAt: string;
  verdict: DnsDoctorVerdict;
  whyNotOpening: string;
  apexStatus: "ok" | "cloudflare" | "mismatch" | "no_records" | "unknown";
  records: DnsDoctorRecord[];
  fixes: DnsDoctorFix[];
  cloudflareConnected: boolean;
  cloudflareZoneUrl?: string | null;
  templates: DnsTemplateSuggestion[];
};

export type DnsHubSiteItem = {
  siteId: string;
  domain: string;
  serverId: string;
  serverName?: string;
  serverHost: string;
  apexStatus: "ok" | "cloudflare" | "mismatch" | "no_records" | "unknown";
  message: string;
  resolvedIps: string[];
  serverIps: string[];
  checkedAt: string;
};

export type DnsHubResponse = {
  summary: {
    sites: number;
    ok: number;
    cloudflare: number;
    problems: number;
  };
  sites: DnsHubSiteItem[];
  templates: DnsTemplateSuggestion[];
};

export const DNS_TEMPLATES: DnsTemplateSuggestion[] = [
  {
    id: "wordpress",
    title: "WordPress (site)",
    summary: "Aponta o domínio e www para o IP do servidor (ou proxy Cloudflare).",
    records: [
      { type: "A", name: "@", value: "<IP_DO_SERVIDOR>", note: "Registro apex" },
      { type: "A", name: "www", value: "<IP_DO_SERVIDOR>", note: "Ou CNAME www → domínio apex" },
      { type: "AAAA", name: "@", value: "<IPV6_OPCIONAL>", note: "Só se o servidor tiver IPv6" },
    ],
  },
  {
    id: "email",
    title: "E-mail (MX + SPF)",
    summary: "Registros típicos para receber e autenticar e-mail do domínio.",
    records: [
      { type: "MX", name: "@", value: "10 mail.exemplo.com", note: "Prioridade e host MX" },
      { type: "TXT", name: "@", value: "v=spf1 a mx ~all", note: "SPF básico" },
      { type: "TXT", name: "_dmarc", value: "v=DMARC1; p=none; rua=mailto:admin@exemplo.com" },
    ],
  },
  {
    id: "redirect",
    title: "Redirecionamento / alias",
    summary: "Mantém o apex no servidor e usa CNAME para subdomínios de alias.",
    records: [
      { type: "A", name: "@", value: "<IP_DO_SERVIDOR>" },
      { type: "CNAME", name: "blog", value: "exemplo.com", note: "Subdomínio apontando para o apex" },
    ],
  },
];

export function dnsVerdictLabel(verdict: DnsDoctorVerdict): string {
  if (verdict === "healthy") return "Saudável";
  if (verdict === "cloudflare_proxy") return "Proxy Cloudflare";
  if (verdict === "mispointed") return "Apontamento incorreto";
  if (verdict === "no_records") return "Sem registros";
  if (verdict === "partial") return "Parcial";
  return "Indeterminado";
}
