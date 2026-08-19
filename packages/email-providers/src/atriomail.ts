import type { EmailDnsBundle } from "@opspanel/contracts";
import { defaultAtriomailDnsBundle } from "./health.js";

export type AtriomailConfig = {
  apiUrl: string;
  apiKey: string;
  mxHost?: string;
  spfInclude?: string;
  webmailBaseUrl?: string;
};

type ApiError = { error?: { message?: string }; message?: string };

async function request<T>(cfg: AtriomailConfig, method: string, path: string, body?: unknown): Promise<T> {
  const base = cfg.apiUrl.replace(/\/$/, "");
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "X-API-Key": cfg.apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & ApiError;
  if (!res.ok) {
    const msg = json.error?.message || json.message || `Atriomail HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

function parseDnsFromResponse(domain: string, raw: unknown, cfg: AtriomailConfig): EmailDnsBundle {
  if (raw && typeof raw === "object") {
    const obj = raw as {
      dns?: EmailDnsBundle;
      dns_records?: { type: string; name?: string; content: string; priority?: number }[];
      mx?: { priority: number; host: string }[];
    };
    if (obj.dns?.mx?.length) return obj.dns;
    if (obj.dns_records?.length) {
      const mx = obj.dns_records
        .filter((r) => r.type === "MX")
        .map((r) => ({ priority: r.priority ?? 10, host: r.content }));
      const txt = obj.dns_records
        .filter((r) => r.type === "TXT")
        .map((r) => ({ type: "TXT" as const, name: r.name || domain, content: r.content }));
      if (mx.length) return { mx, txt };
    }
    if (obj.mx?.length) {
      return defaultAtriomailDnsBundle({
        domain,
        mxHost: obj.mx[0]!.host,
        spfInclude: cfg.spfInclude || "spf.atriomail.com",
      });
    }
  }
  return defaultAtriomailDnsBundle({
    domain,
    mxHost: cfg.mxHost || "mail.atriomail.com",
    spfInclude: cfg.spfInclude || "spf.atriomail.com",
  });
}

export async function atriomailProvisionDomain(
  cfg: AtriomailConfig,
  domain: string,
): Promise<{ providerDomainId: string; dns: EmailDnsBundle; webmailUrl?: string }> {
  const clean = domain.toLowerCase().trim();
  try {
    const created = await request<{ id?: string; domain_id?: string; dns?: EmailDnsBundle; dns_records?: unknown }>(
      cfg,
      "POST",
      "/v1/domains",
      { domain: clean, name: clean },
    );
    const providerDomainId = String(created.id || created.domain_id || clean);
    const dns = parseDnsFromResponse(clean, created.dns_records ?? created, cfg);
    const webmailUrl = cfg.webmailBaseUrl?.replace(/\/$/, "");
    return { providerDomainId, dns, webmailUrl };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("409") || msg.toLowerCase().includes("exists")) {
      const listed = await request<{ id?: string; domains?: { id: string; name: string }[] }>(
        cfg,
        "GET",
        `/v1/domains?domain=${encodeURIComponent(clean)}`,
      );
      const found = listed.domains?.find((d) => d.name === clean);
      const providerDomainId = found?.id || clean;
      return {
        providerDomainId,
        dns: defaultAtriomailDnsBundle({
          domain: clean,
          mxHost: cfg.mxHost || "mail.atriomail.com",
          spfInclude: cfg.spfInclude || "spf.atriomail.com",
        }),
        webmailUrl: cfg.webmailBaseUrl?.replace(/\/$/, ""),
      };
    }
    throw err;
  }
}

export async function atriomailCreateMailbox(
  cfg: AtriomailConfig,
  input: {
    domain: string;
    providerDomainId?: string;
    localPart: string;
    displayName?: string;
    quotaMb?: number;
    password?: string;
  },
): Promise<{
  providerMailboxId: string;
  email: string;
  webmailUrl?: string;
  imap?: { host: string; port: number; security: "TLS" };
  smtp?: { host: string; port: number; security: "STARTTLS" };
  generatedPassword?: string;
}> {
  const local = input.localPart.toLowerCase().trim();
  const domain = input.domain.toLowerCase().trim();
  const body: Record<string, unknown> = {
    domain,
    local_part: local,
    localPart: local,
    display_name: input.displayName,
    displayName: input.displayName,
    quota_mb: input.quotaMb ?? 10240,
    quotaMb: input.quotaMb ?? 10240,
  };
  if (input.password) body.password = input.password;

  const created = await request<{
    id?: string;
    mailbox_id?: string;
    email?: string;
    password?: string;
    imap_host?: string;
    smtp_host?: string;
    webmail_url?: string;
  }>(cfg, "POST", "/v1/mailboxes", body);

  const email = created.email || `${local}@${domain}`;
  const imapHost = created.imap_host || cfg.mxHost || "mail.atriomail.com";
  const smtpHost = created.smtp_host || cfg.mxHost || "mail.atriomail.com";
  return {
    providerMailboxId: String(created.id || created.mailbox_id || email),
    email,
    webmailUrl: created.webmail_url || cfg.webmailBaseUrl?.replace(/\/$/, ""),
    imap: { host: imapHost, port: 993, security: "TLS" },
    smtp: { host: smtpHost, port: 587, security: "STARTTLS" },
    generatedPassword: created.password,
  };
}

export async function atriomailDeleteMailbox(cfg: AtriomailConfig, providerMailboxId: string): Promise<void> {
  await request(cfg, "DELETE", `/v1/mailboxes/${encodeURIComponent(providerMailboxId)}`);
}

export async function atriomailListMailboxes(
  cfg: AtriomailConfig,
  domain: string,
): Promise<Array<{ providerMailboxId: string; email: string; quotaMb?: number }>> {
  const res = await request<{ mailboxes?: { id: string; email: string; quota_mb?: number }[] }>(
    cfg,
    "GET",
    `/v1/domains/${encodeURIComponent(domain)}/mailboxes`,
  );
  return (res.mailboxes ?? []).map((m) => ({
    providerMailboxId: m.id,
    email: m.email,
    quotaMb: m.quota_mb,
  }));
}

export function atriomailConfigured(cfg: Partial<AtriomailConfig>): cfg is AtriomailConfig {
  return Boolean(cfg.apiUrl && cfg.apiKey);
}
