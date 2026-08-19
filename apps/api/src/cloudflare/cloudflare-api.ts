export type CloudflareAuth =
  | { mode: "token"; apiToken: string }
  | { mode: "global"; apiKey: string; email: string }
  | {
      mode: "oauth";
      accessToken: string;
      refreshToken: string;
      expiresAt: number;
      scope?: string;
    };

type CfResult<T> = { success: boolean; result: T; errors: { message: string }[]; messages?: unknown[] };

export class CloudflareApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "CloudflareApiError";
  }
}

function authHeaders(auth: CloudflareAuth): Record<string, string> {
  if (auth.mode === "token") {
    return { Authorization: `Bearer ${auth.apiToken}` };
  }
  if (auth.mode === "oauth") {
    return { Authorization: `Bearer ${auth.accessToken}` };
  }
  return {
    "X-Auth-Email": auth.email,
    "X-Auth-Key": auth.apiKey,
  };
}

export async function cloudflareRequest<T>(
  auth: CloudflareAuth,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: {
      ...authHeaders(auth),
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json()) as CfResult<T>;
  if (!res.ok || !json.success) {
    const msg = json.errors?.map((e) => e.message).filter(Boolean).join("; ") || `Cloudflare HTTP ${res.status}`;
    throw new CloudflareApiError(msg, res.status, json.errors);
  }
  return json.result;
}

export type CfZone = {
  id: string;
  name: string;
  status: string;
  paused: boolean;
  type: string;
  name_servers?: string[];
  plan?: { name?: string };
};

export type CfDnsRecord = {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied?: boolean;
  proxiable?: boolean;
  ttl: number;
  priority?: number;
  locked?: boolean;
  comment?: string | null;
};

export type CfPageRule = {
  id: string;
  targets: { target: string; constraint: { operator: string; value: string } }[];
  actions: { id: string; value?: unknown }[];
  priority: number;
  status: string;
};

export async function verifyCloudflareAuth(auth: CloudflareAuth): Promise<{ ok: true; accountHint: string }> {
  if (auth.mode === "token") {
    const result = await cloudflareRequest<{ status?: string; id?: string }>(auth, "GET", "/user/tokens/verify");
    return { ok: true, accountHint: result.status === "active" ? "Token ativo" : "Token Cloudflare" };
  }
  if (auth.mode === "oauth") {
    const zones = await cloudflareRequest<{ id: string; name: string }[]>(auth, "GET", "/zones?per_page=1");
    return {
      ok: true,
      accountHint: zones[0]?.name ? `OAuth · zona ${zones[0].name}` : "OAuth Cloudflare",
    };
  }
  const user = await cloudflareRequest<{ email?: string; id?: string }>(auth, "GET", "/user");
  return { ok: true, accountHint: user.email ?? "Conta Cloudflare" };
}

export async function findZoneByDomain(auth: CloudflareAuth, domain: string): Promise<CfZone | null> {
  const clean = domain.toLowerCase().replace(/\.$/, "");
  const candidates = [clean];
  const parts = clean.split(".");
  if (parts.length > 2) {
    candidates.push(parts.slice(-2).join("."));
    if (parts.length > 3) candidates.push(parts.slice(-3).join("."));
  }
  for (const name of candidates) {
    const zones = await cloudflareRequest<CfZone[]>(
      auth,
      "GET",
      `/zones?name=${encodeURIComponent(name)}&status=active`,
    );
    if (zones[0]) return zones[0];
  }
  // fallback: list match
  const zones = await cloudflareRequest<CfZone[]>(auth, "GET", `/zones?per_page=50`);
  return zones.find((z) => clean === z.name || clean.endsWith(`.${z.name}`)) ?? null;
}

export async function listDnsRecords(auth: CloudflareAuth, zoneId: string): Promise<CfDnsRecord[]> {
  const all: CfDnsRecord[] = [];
  let page = 1;
  for (;;) {
    const batch = await cloudflareRequest<CfDnsRecord[]>(
      auth,
      "GET",
      `/zones/${zoneId}/dns_records?per_page=100&page=${page}`,
    );
    all.push(...batch);
    if (batch.length < 100) break;
    page += 1;
    if (page > 20) break;
  }
  return all;
}

export async function createDnsRecord(
  auth: CloudflareAuth,
  zoneId: string,
  input: { type: string; name: string; content: string; proxied?: boolean; ttl?: number; priority?: number },
): Promise<CfDnsRecord> {
  return cloudflareRequest<CfDnsRecord>(auth, "POST", `/zones/${zoneId}/dns_records`, {
    type: input.type,
    name: input.name,
    content: input.content,
    proxied: input.proxied ?? false,
    ttl: input.ttl ?? 1,
    ...(input.priority != null ? { priority: input.priority } : {}),
  });
}

export async function updateDnsRecord(
  auth: CloudflareAuth,
  zoneId: string,
  recordId: string,
  input: { type: string; name: string; content: string; proxied?: boolean; ttl?: number; priority?: number },
): Promise<CfDnsRecord> {
  return cloudflareRequest<CfDnsRecord>(auth, "PUT", `/zones/${zoneId}/dns_records/${recordId}`, {
    type: input.type,
    name: input.name,
    content: input.content,
    proxied: input.proxied ?? false,
    ttl: input.ttl ?? 1,
    ...(input.priority != null ? { priority: input.priority } : {}),
  });
}

export async function deleteDnsRecord(auth: CloudflareAuth, zoneId: string, recordId: string): Promise<void> {
  await cloudflareRequest(auth, "DELETE", `/zones/${zoneId}/dns_records/${recordId}`);
}

export async function patchZoneSetting(
  auth: CloudflareAuth,
  zoneId: string,
  setting: string,
  value: unknown,
): Promise<unknown> {
  return cloudflareRequest(auth, "PATCH", `/zones/${zoneId}/settings/${setting}`, { value });
}

export async function listPageRules(auth: CloudflareAuth, zoneId: string): Promise<CfPageRule[]> {
  return cloudflareRequest<CfPageRule[]>(auth, "GET", `/zones/${zoneId}/pagerules`);
}

export async function createPageRule(
  auth: CloudflareAuth,
  zoneId: string,
  rule: { targets: CfPageRule["targets"]; actions: CfPageRule["actions"]; priority?: number; status?: string },
): Promise<CfPageRule> {
  return cloudflareRequest<CfPageRule>(auth, "POST", `/zones/${zoneId}/pagerules`, {
    targets: rule.targets,
    actions: rule.actions,
    priority: rule.priority ?? 1,
    status: rule.status ?? "active",
  });
}

export async function updatePageRule(
  auth: CloudflareAuth,
  zoneId: string,
  ruleId: string,
  rule: { targets: CfPageRule["targets"]; actions: CfPageRule["actions"]; priority?: number; status?: string },
): Promise<CfPageRule> {
  return cloudflareRequest<CfPageRule>(auth, "PUT", `/zones/${zoneId}/pagerules/${ruleId}`, {
    targets: rule.targets,
    actions: rule.actions,
    priority: rule.priority ?? 1,
    status: rule.status ?? "active",
  });
}

export async function deletePageRule(auth: CloudflareAuth, zoneId: string, ruleId: string): Promise<void> {
  await cloudflareRequest(auth, "DELETE", `/zones/${zoneId}/pagerules/${ruleId}`);
}

/** Otimizações padrão seguras para WordPress/WordOps. */
export const WORDOPS_CF_OPTIMIZATIONS: { id: string; label: string; value: unknown }[] = [
  { id: "ssl", label: "SSL/TLS Full", value: "full" },
  { id: "always_use_https", label: "Sempre HTTPS", value: "on" },
  { id: "min_tls_version", label: "TLS mínimo 1.2", value: "1.2" },
  { id: "automatic_https_rewrites", label: "Rewrite HTTPS automático", value: "on" },
  { id: "brotli", label: "Brotli", value: "on" },
  { id: "http3", label: "HTTP/3 (QUIC)", value: "on" },
  { id: "0rtt", label: "0-RTT", value: "on" },
  { id: "websockets", label: "WebSockets", value: "on" },
  { id: "early_hints", label: "Early Hints", value: "on" },
  { id: "security_level", label: "Segurança média", value: "medium" },
  { id: "browser_check", label: "Browser Integrity Check", value: "on" },
  { id: "email_obfuscation", label: "Ofuscar e-mails", value: "on" },
  { id: "rocket_loader", label: "Rocket Loader desligado (melhor p/ WP)", value: "off" },
  { id: "minify", label: "Minificar CSS/HTML", value: { css: "on", html: "on", js: "off" } },
];
