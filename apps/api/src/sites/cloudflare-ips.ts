/** Faixas IPv4/IPv6 públicas da Cloudflare (proxy). Fonte: https://www.cloudflare.com/ips/ */
export const CLOUDFLARE_IPV4_CIDRS = [
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "108.162.192.0/18",
  "131.0.72.0/22",
  "141.101.64.0/18",
  "162.158.0.0/15",
  "172.64.0.0/13",
  "173.245.48.0/20",
  "188.114.96.0/20",
  "190.93.240.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
] as const;

export const CLOUDFLARE_IPV6_PREFIXES = [
  "2400:cb00:",
  "2606:4700:",
  "2803:f800:",
  "2405:b500:",
  "2405:8100:",
  "2a06:98c0:",
  "2c0f:f248:",
] as const;

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = ((value << 8) + octet) >>> 0;
  }
  return value;
}

export function isIpv4InCidr(ip: string, cidr: string): boolean {
  const [network, bitsRaw] = cidr.split("/");
  if (!network || !bitsRaw) return false;
  const bits = Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;

  const ipInt = ipv4ToInt(ip);
  const networkInt = ipv4ToInt(network);
  if (ipInt == null || networkInt == null) return false;

  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (networkInt & mask);
}

export function isCloudflareIpv4(ip: string): boolean {
  return CLOUDFLARE_IPV4_CIDRS.some((cidr) => isIpv4InCidr(ip, cidr));
}

export function isCloudflareIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  return CLOUDFLARE_IPV6_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function isCloudflareIp(ip: string): boolean {
  if (ip.includes(":")) return isCloudflareIpv6(ip);
  return isCloudflareIpv4(ip);
}

export function resolvedViaCloudflare(resolvedIps: string[]): boolean {
  return resolvedIps.length > 0 && resolvedIps.every((ip) => isCloudflareIp(ip));
}

export function anyCloudflareIp(resolvedIps: string[]): boolean {
  return resolvedIps.some((ip) => isCloudflareIp(ip));
}
