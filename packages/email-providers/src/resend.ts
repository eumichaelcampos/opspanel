import type { EmailDnsBundle } from "@opspanel/contracts";

export type ResendConfig = {
  apiKey: string;
};

async function resendRequest<T>(cfg: ResendConfig, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.resend.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(json.message || `Resend HTTP ${res.status}`);
  return json;
}

export async function resendEnsureDomain(
  cfg: ResendConfig,
  domain: string,
): Promise<{ providerRef: string; verified: boolean; dns?: EmailDnsBundle }> {
  const clean = domain.toLowerCase().trim();
  try {
    const created = await resendRequest<{
      id: string;
      status?: string;
      records?: { record: string; name: string; type: string; value: string; priority?: number }[];
    }>(cfg, "POST", "/domains", { name: clean });
    const dns = resendRecordsToBundle(clean, created.records ?? []);
    return {
      providerRef: created.id,
      verified: created.status === "verified",
      dns,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (!msg.toLowerCase().includes("already")) throw err;
    const listed = await resendRequest<{ data?: { id: string; name: string; status?: string }[] }>(
      cfg,
      "GET",
      "/domains",
    );
    const found = listed.data?.find((d) => d.name === clean);
    if (!found) throw err;
    return { providerRef: found.id, verified: found.status === "verified" };
  }
}

function resendRecordsToBundle(
  domain: string,
  records: { record: string; name: string; type: string; value: string; priority?: number }[],
): EmailDnsBundle {
  const mx = records
    .filter((r) => r.type === "MX" || r.record === "MX")
    .map((r) => ({ priority: r.priority ?? 10, host: r.value }));
  const txt = records
    .filter((r) => r.type === "TXT" || r.record === "TXT")
    .map((r) => ({
      type: "TXT" as const,
      name: r.name === "@" || r.name === domain ? domain : r.name,
      content: r.value,
    }));
  return { mx, txt };
}

export async function resendSendTest(cfg: ResendConfig, input: { from: string; to: string; domain: string }) {
  return resendRequest<{ id: string }>(cfg, "POST", "/emails", {
    from: input.from,
    to: [input.to],
    subject: `Teste OpsPanel · ${input.domain}`,
    text: "Este é um e-mail de teste enviado pelo OpsPanel.",
  });
}

export function resendConfigured(cfg: Partial<ResendConfig>): cfg is ResendConfig {
  return Boolean(cfg.apiKey);
}
