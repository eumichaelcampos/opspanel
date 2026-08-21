import { resolve4, resolve6, resolveCname, resolveMx, resolveTxt } from "node:dns/promises";
import {
  DNS_TEMPLATES,
  type DnsDoctorFix,
  type DnsDoctorRecord,
  type DnsDoctorResult,
  type DnsDoctorVerdict,
} from "@opspanel/contracts";
import {
  buildDnsCheckMessage,
  checkSiteDns,
  compareDnsIps,
  type SiteDnsCheckResult,
} from "../sites/dns-check.js";

async function safeResolve<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export async function diagnoseDns(input: {
  domain: string;
  serverHost: string;
  serverId?: string;
  serverName?: string;
  siteId?: string;
  cloudflareConnected?: boolean;
}): Promise<DnsDoctorResult> {
  const domain = input.domain.toLowerCase().trim();
  const www = domain.startsWith("www.") ? domain : `www.${domain}`;

  const apexCheck = await checkSiteDns(domain, input.serverHost);
  const serverIps = apexCheck.serverIps;

  const [aaaa, cnameWww, mx, txt, wwwA] = await Promise.all([
    safeResolve(() => resolve6(domain), [] as string[]),
    safeResolve(() => resolveCname(www), [] as string[]),
    safeResolve(() => resolveMx(domain), [] as { exchange: string; priority: number }[]),
    safeResolve(() => resolveTxt(domain), [] as string[][]),
    safeResolve(() => resolve4(www), [] as string[]),
  ]);

  const records: DnsDoctorRecord[] = [];

  const aValues = apexCheck.resolvedIps.filter((ip) => !ip.includes(":"));
  const aaaaFromApex = apexCheck.resolvedIps.filter((ip) => ip.includes(":"));
  const aaaaValues = aaaa.length ? aaaa : aaaaFromApex;

  if (aValues.length === 0 && aaaaValues.length === 0) {
    records.push({
      type: "A",
      name: domain,
      values: [],
      expected: serverIps.filter((ip) => !ip.includes(":")),
      status: "missing",
      detail: "Nenhum registro A encontrado para o domínio apex.",
    });
  } else if (aValues.length) {
    const status =
      apexCheck.status === "ok"
        ? "ok"
        : apexCheck.status === "cloudflare"
          ? "info"
          : apexCheck.status === "mismatch"
            ? "error"
            : "warning";
    records.push({
      type: "A",
      name: domain,
      values: aValues,
      expected: serverIps.filter((ip) => !ip.includes(":")),
      status,
      detail:
        status === "ok"
          ? "A aponta para o IP do servidor."
          : status === "info"
            ? "A aponta para IPs da Cloudflare (proxy laranja)."
            : `A atual: ${aValues.join(", ")}. Esperado: ${serverIps.join(", ") || "IP do servidor"}.`,
    });
  }

  if (aaaaValues.length) {
    const v6Expected = serverIps.filter((ip) => ip.includes(":"));
    const aaaaOk = v6Expected.length === 0 || aaaaValues.some((ip) => v6Expected.includes(ip));
    records.push({
      type: "AAAA",
      name: domain,
      values: aaaaValues,
      expected: v6Expected.length ? v6Expected : undefined,
      status: aaaaOk ? "ok" : "warning",
      detail: aaaaOk
        ? "AAAA presente."
        : "AAAA não coincide com o IPv6 do servidor (pode ser intencional).",
    });
  } else {
    records.push({
      type: "AAAA",
      name: domain,
      values: [],
      status: "info",
      detail: "Sem AAAA (comum se o servidor só tem IPv4).",
    });
  }

  if (cnameWww.length) {
    records.push({
      type: "CNAME",
      name: www,
      values: cnameWww,
      status: "ok",
      detail: `www é CNAME para ${cnameWww.join(", ")}.`,
    });
  } else if (wwwA.length) {
    const wwwStatus = compareDnsIps(serverIps, wwwA, apexCheck.status === "cloudflare");
    records.push({
      type: "A",
      name: www,
      values: wwwA,
      expected: serverIps.filter((ip) => !ip.includes(":")),
      status: wwwStatus === "ok" || wwwStatus === "cloudflare" ? "ok" : "warning",
      detail:
        wwwStatus === "ok" || wwwStatus === "cloudflare"
          ? "www aponta corretamente."
          : `www aponta para ${wwwA.join(", ")}, diferente do servidor.`,
    });
  } else {
    records.push({
      type: "CNAME",
      name: www,
      values: [],
      status: "missing",
      detail: "www sem A nem CNAME. Visitantes em www. podem falhar.",
    });
  }

  if (mx.length) {
    records.push({
      type: "MX",
      name: domain,
      values: mx
        .slice()
        .sort((a, b) => a.priority - b.priority)
        .map((m) => `${m.priority} ${m.exchange}`),
      status: "info",
      detail: "MX publicado (e-mail do domínio).",
    });
  } else {
    records.push({
      type: "MX",
      name: domain,
      values: [],
      status: "info",
      detail: "Sem MX. Só relevante se o domínio receber e-mail.",
    });
  }

  const txtFlat = txt.map((parts) => parts.join(""));
  if (txtFlat.length) {
    const hasSpf = txtFlat.some((t) => /v=spf1/i.test(t));
    records.push({
      type: "TXT",
      name: domain,
      values: txtFlat.slice(0, 8),
      status: hasSpf ? "ok" : "info",
      detail: hasSpf ? "TXT inclui SPF." : "TXT encontrados (verifique SPF/DKIM se usar e-mail).",
    });
  } else {
    records.push({
      type: "TXT",
      name: domain,
      values: [],
      status: "info",
      detail: "Sem TXT no apex.",
    });
  }

  const fixes = buildFixes(apexCheck, records, input.siteId, Boolean(input.cloudflareConnected));
  const verdict = toVerdict(apexCheck, records);
  const whyNotOpening = buildWhyNotOpening(apexCheck, verdict, serverIps);

  const templates = DNS_TEMPLATES.map((t) => ({
    ...t,
    records: t.records.map((r) => ({
      ...r,
      value: r.value.replace("<IP_DO_SERVIDOR>", serverIps.find((ip) => !ip.includes(":")) ?? "<IP_DO_SERVIDOR>"),
    })),
  }));

  return {
    domain,
    serverId: input.serverId,
    serverName: input.serverName,
    serverHost: input.serverHost,
    serverIps,
    checkedAt: new Date().toISOString(),
    verdict,
    whyNotOpening,
    apexStatus: apexCheck.status,
    records,
    fixes,
    cloudflareConnected: Boolean(input.cloudflareConnected),
    cloudflareZoneUrl: input.cloudflareConnected
      ? `https://dash.cloudflare.com/?to=/:account/:zone/dns/records`
      : null,
    templates,
  };
}

function toVerdict(
  apex: SiteDnsCheckResult,
  records: DnsDoctorRecord[],
): DnsDoctorVerdict {
  if (apex.status === "ok") {
    const wwwBad = records.some(
      (r) => (r.name.startsWith("www.") || r.name === "www") && (r.status === "error" || r.status === "missing"),
    );
    return wwwBad ? "partial" : "healthy";
  }
  if (apex.status === "cloudflare") return "cloudflare_proxy";
  if (apex.status === "no_records") return "no_records";
  if (apex.status === "mismatch") return "mispointed";
  return "unknown";
}

function buildWhyNotOpening(
  apex: SiteDnsCheckResult,
  verdict: DnsDoctorVerdict,
  serverIps: string[],
): string {
  if (verdict === "healthy") {
    return "O DNS apex aponta para o servidor. Se o site não abrir, verifique SSL, Nginx e se o site está habilitado.";
  }
  if (verdict === "cloudflare_proxy") {
    return "O domínio está atrás do proxy Cloudflare. O navegador fala com a Cloudflare, não diretamente com o IP do servidor. Confirme o registro de origem (DNS cinza/laranja) e o SSL na Cloudflare.";
  }
  if (verdict === "no_records") {
    return `Não há registro A/AAAA público para ${apex.domain}. Sem isso o navegador não encontra o servidor (${serverIps.join(", ") || apex.serverHost}).`;
  }
  if (verdict === "mispointed") {
    return `O domínio resolve para ${apex.resolvedIps.join(", ") || "(vazio)"}, mas o servidor é ${serverIps.join(", ") || apex.serverHost}. O tráfego está indo para outro host.`;
  }
  if (verdict === "partial") {
    return "O apex parece correto, mas www ou outro registro ainda está inconsistente. Isso explica falhas só em alguns URLs.";
  }
  return buildDnsCheckMessage(apex.status, apex.domain, serverIps, apex.resolvedIps);
}

function buildFixes(
  apex: SiteDnsCheckResult,
  records: DnsDoctorRecord[],
  siteId: string | undefined,
  cloudflareConnected: boolean,
): DnsDoctorFix[] {
  const fixes: DnsDoctorFix[] = [];
  const cfHref = siteId ? `/sites/${siteId}?tab=cloudflare` : "/settings/account";
  const targetIp = apex.serverIps.find((ip) => !ip.includes(":")) ?? apex.serverIps[0] ?? apex.serverHost;

  if (apex.status === "no_records" || apex.status === "mismatch") {
    fixes.push({
      id: "create-a",
      title: "Criar ou corrigir registro A",
      detail: `Aponte ${apex.domain} para ${targetIp} e remova A antigos que apontem para outro IP.`,
      priority: "high",
      href: cloudflareConnected ? cfHref : undefined,
    });
  }

  if (apex.status === "cloudflare") {
    fixes.push({
      id: "cf-origin",
      title: "Conferir origem na Cloudflare",
      detail: `No painel Cloudflare, o registro A (origem) deve ser ${targetIp}. Proxy laranja é esperado.`,
      priority: "medium",
      href: cfHref,
    });
  }

  const wwwMissing = records.some((r) => r.name.includes("www") && r.status === "missing");
  if (wwwMissing) {
    fixes.push({
      id: "www",
      title: "Configurar www",
      detail: `Crie A para www → ${targetIp} ou CNAME www → ${apex.domain}.`,
      priority: "medium",
      href: cloudflareConnected ? cfHref : undefined,
    });
  }

  if (cloudflareConnected && siteId) {
    fixes.push({
      id: "open-cf",
      title: "Abrir painel Cloudflare do site",
      detail: "Gerencie registros e use apontar para o servidor com um clique.",
      priority: "low",
      href: cfHref,
    });
  } else if (!cloudflareConnected) {
    fixes.push({
      id: "connect-cf",
      title: "Conectar Cloudflare (opcional)",
      detail: "Com a conta conectada, o OpsPanel pode sugerir e aplicar correções de DNS.",
      priority: "low",
      href: "/settings/account",
    });
  }

  if (!fixes.length) {
    fixes.push({
      id: "all-good",
      title: "Nenhuma correção urgente",
      detail: "O apontamento principal está coerente com o servidor.",
      priority: "low",
    });
  }

  return fixes;
}
