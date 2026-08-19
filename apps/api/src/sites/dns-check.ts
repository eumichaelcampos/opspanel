import { resolve4, resolve6 } from "node:dns/promises";
import { anyCloudflareIp, resolvedViaCloudflare } from "./cloudflare-ips.js";

export type SiteDnsStatus = "ok" | "cloudflare" | "mismatch" | "no_records" | "unknown";

export interface SiteDnsCheckResult {
  status: SiteDnsStatus;
  domain: string;
  serverHost: string;
  serverIps: string[];
  resolvedIps: string[];
  proxyProvider?: "cloudflare" | null;
  checkedAt: string;
  message: string;
}

const IPV4_REGEX = /^(?:\d{1,3}\.){3}\d{1,3}$/;

export function compareDnsIps(
  serverIps: string[],
  resolvedIps: string[],
  cloudflareViaHttp = false,
): SiteDnsStatus {
  if (resolvedIps.length === 0) return "no_records";
  if (serverIps.length === 0) return "unknown";
  if (resolvedIps.some((ip) => serverIps.includes(ip))) return "ok";
  if (resolvedViaCloudflare(resolvedIps) || cloudflareViaHttp || anyCloudflareIp(resolvedIps)) {
    return "cloudflare";
  }
  return "mismatch";
}

export function buildDnsCheckMessage(
  status: SiteDnsStatus,
  domain: string,
  serverIps: string[],
  resolvedIps: string[],
): string {
  const serverLabel = serverIps.join(", ") || "IP do servidor";
  const resolvedLabel = resolvedIps.join(", ");

  switch (status) {
    case "ok":
      return `O domínio ${domain} está apontando diretamente para o servidor (${serverLabel}).`;
    case "cloudflare":
      return `O domínio ${domain} está atrás do proxy Cloudflare (nuvem laranja). O DNS público mostra IPs da Cloudflare (${resolvedLabel}), o que é esperado. A origem no servidor deve ser ${serverLabel}.`;
    case "no_records":
      return `Nenhum registro A/AAAA encontrado para ${domain}. Crie um registro A apontando para ${serverLabel}.`;
    case "mismatch":
      return `O domínio ${domain} ainda não aponta para este servidor. DNS atual: ${resolvedLabel}. Servidor: ${serverLabel}.`;
    default:
      return `Não foi possível verificar se ${domain} aponta para o servidor.`;
  }
}

async function resolveHostIps(host: string): Promise<string[]> {
  const trimmed = host.trim();
  if (!trimmed) return [];

  if (IPV4_REGEX.test(trimmed)) return [trimmed];

  const ips = new Set<string>();
  try {
    for (const ip of await resolve4(trimmed)) ips.add(ip);
  } catch {
    /* ignore */
  }
  try {
    for (const ip of await resolve6(trimmed)) ips.add(ip);
  } catch {
    /* ignore */
  }
  return [...ips];
}

async function resolveDomainIps(domain: string): Promise<string[]> {
  const ips = new Set<string>();
  try {
    for (const ip of await resolve4(domain)) ips.add(ip);
  } catch {
    /* ignore */
  }
  try {
    for (const ip of await resolve6(domain)) ips.add(ip);
  } catch {
    /* ignore */
  }
  return [...ips];
}

async function detectCloudflareViaHttp(domain: string): Promise<boolean> {
  const urls = [`https://${domain}`, `http://${domain}`];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        signal: AbortSignal.timeout(8_000),
      });
      const server = res.headers.get("server")?.toLowerCase() ?? "";
      if (res.headers.has("cf-ray") || server.includes("cloudflare")) return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

export async function checkSiteDns(domain: string, serverHost: string): Promise<SiteDnsCheckResult> {
  const normalizedDomain = domain.toLowerCase().trim();
  const [serverIps, resolvedIps, cloudflareViaHttp] = await Promise.all([
    resolveHostIps(serverHost),
    resolveDomainIps(normalizedDomain),
    detectCloudflareViaHttp(normalizedDomain),
  ]);

  const status = compareDnsIps(serverIps, resolvedIps, cloudflareViaHttp);
  return {
    status,
    domain: normalizedDomain,
    serverHost: serverHost.trim(),
    serverIps,
    resolvedIps,
    proxyProvider: status === "cloudflare" ? "cloudflare" : null,
    checkedAt: new Date().toISOString(),
    message: buildDnsCheckMessage(status, normalizedDomain, serverIps, resolvedIps),
  };
}
