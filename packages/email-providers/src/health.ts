import { resolveMx, resolveTxt } from "node:dns/promises";
import type { DnsAuthStatus, EmailDnsBundle, EmailHealthReport } from "@opspanel/contracts";

function normalizeDomain(domain: string): string {
  return domain.toLowerCase().trim().replace(/\.$/, "");
}

async function txtRecords(name: string): Promise<string[]> {
  try {
    const rows = await resolveTxt(name);
    return rows.map((parts) => parts.join(""));
  } catch {
    return [];
  }
}

function spfStatus(records: string[]): DnsAuthStatus {
  const spf = records.find((r) => r.toLowerCase().startsWith("v=spf1"));
  if (!spf) return "missing";
  if (spf.length > 450) return "invalid";
  return "ok";
}

function dmarcStatus(records: string[]): DnsAuthStatus {
  const dmarc = records.find((r) => r.toLowerCase().startsWith("v=dmarc1"));
  if (!dmarc) return "missing";
  return "ok";
}

async function dkimStatus(domain: string): Promise<{ status: DnsAuthStatus; selectors: string[] }> {
  const selectors = ["default", "dkim", "mail", "selector1", "selector2", "google"];
  const found: string[] = [];
  for (const sel of selectors) {
    const host = `${sel}._domainkey.${domain}`;
    const txts = await txtRecords(host);
    if (txts.some((t) => t.includes("v=DKIM1") || t.includes("p="))) found.push(sel);
  }
  if (found.length === 0) return { status: "missing", selectors: [] };
  return { status: "ok", selectors: found };
}

async function mxStatus(domain: string, expectedHosts?: string[]): Promise<{ status: DnsAuthStatus; hosts: string[] }> {
  try {
    const mx = await resolveMx(domain);
    const hosts = mx.sort((a, b) => a.priority - b.priority).map((r) => r.exchange.toLowerCase().replace(/\.$/, ""));
    if (hosts.length === 0) return { status: "missing", hosts: [] };
    if (!expectedHosts?.length) return { status: "ok", hosts };
    const expected = expectedHosts.map((h) => h.toLowerCase().replace(/\.$/, ""));
    const match = hosts.some((h) => expected.some((e) => h === e || h.endsWith(`.${e}`)));
    return { status: match ? "ok" : "invalid", hosts };
  } catch {
    return { status: "missing", hosts: [] };
  }
}

export async function checkEmailHealth(
  domain: string,
  expectedMxHosts?: string[],
): Promise<EmailHealthReport> {
  const normalized = normalizeDomain(domain);
  const [rootTxt, dmarcTxt, dkim, mx] = await Promise.all([
    txtRecords(normalized),
    txtRecords(`_dmarc.${normalized}`),
    dkimStatus(normalized),
    mxStatus(normalized, expectedMxHosts),
  ]);

  const spf = spfStatus(rootTxt);
  const dmarc = dmarcStatus(dmarcTxt);

  return {
    domain: normalized,
    spf,
    dkim: dkim.status,
    dmarc,
    mx: mx.status,
    details: {
      spfRecord: rootTxt.find((r) => r.toLowerCase().startsWith("v=spf1")),
      dkimSelectors: dkim.selectors,
      dmarcRecord: dmarcTxt.find((r) => r.toLowerCase().startsWith("v=dmarc1")),
      mxHosts: mx.hosts,
    },
    checkedAt: new Date().toISOString(),
  };
}

export function defaultAtriomailDnsBundle(input: {
  domain: string;
  mxHost: string;
  spfInclude: string;
  dkimTxt?: string;
  dkimSelector?: string;
}): EmailDnsBundle {
  const domain = normalizeDomain(input.domain);
  const mxHost = input.mxHost.replace(/\.$/, "");
  const spf = `v=spf1 include:${input.spfInclude} ~all`;
  const txt: EmailDnsBundle["txt"] = [{ type: "TXT", name: domain, content: spf }];
  if (input.dkimTxt && input.dkimSelector) {
    txt.push({
      type: "TXT",
      name: `${input.dkimSelector}._domainkey.${domain}`,
      content: input.dkimTxt,
    });
  }
  txt.push({
    type: "TXT",
    name: `_dmarc.${domain}`,
    content: "v=DMARC1; p=none; rua=mailto:postmaster@" + domain,
  });
  return {
    mx: [{ priority: 10, host: mxHost }],
    txt,
  };
}
