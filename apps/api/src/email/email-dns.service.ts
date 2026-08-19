import { Injectable } from "@nestjs/common";
import type { EmailDnsBundle } from "@opspanel/contracts";
import {
  createDnsRecord,
  findZoneByDomain,
  listDnsRecords,
  updateDnsRecord,
  type CloudflareAuth,
  type CfDnsRecord,
} from "../cloudflare/cloudflare-api";
import { CloudflareService } from "../cloudflare/cloudflare.service";

@Injectable()
export class EmailDnsService {
  constructor(private readonly cloudflare: CloudflareService) {}

  async publishBundle(userId: string, domain: string, bundle: EmailDnsBundle): Promise<{ created: number; updated: number }> {
    const auth = await this.cloudflare.getAuth(userId);
    if (!auth) {
      throw new Error("Conecte sua conta Cloudflare em Configurações → Integrações.");
    }
    return publishEmailDns(auth, domain, bundle);
  }
}

function recordNameMatches(existingName: string, targetName: string, zoneName: string): boolean {
  const a = existingName.toLowerCase().replace(/\.$/, "");
  const b = targetName.toLowerCase().replace(/\.$/, "");
  const zone = zoneName.toLowerCase().replace(/\.$/, "");
  if (a === b) return true;
  if (a === zone && (b === zone || b === "@")) return true;
  if (b === zone && a === zone) return true;
  return a === `${b}.${zone}` || b === `${a}.${zone}`;
}

export async function publishEmailDns(
  auth: CloudflareAuth,
  domain: string,
  bundle: EmailDnsBundle,
): Promise<{ created: number; updated: number }> {
  const zone = await findZoneByDomain(auth, domain);
  if (!zone) throw new Error(`Zona Cloudflare não encontrada para ${domain}.`);

  const existing = await listDnsRecords(auth, zone.id);
  let created = 0;
  let updated = 0;

  for (const mx of bundle.mx) {
    const name = domain;
    const match = findDns(existing, "MX", name, zone.name);
    const content = mx.host.endsWith(".") ? mx.host : `${mx.host}.`;
    if (match) {
      await updateDnsRecord(auth, zone.id, match.id, {
        type: "MX",
        name,
        content,
        priority: mx.priority,
        proxied: false,
        ttl: 1,
      });
      updated += 1;
    } else {
      await createDnsRecord(auth, zone.id, {
        type: "MX",
        name,
        content,
        priority: mx.priority,
        proxied: false,
        ttl: 1,
      });
      created += 1;
    }
  }

  for (const txt of bundle.txt) {
    const match = findDns(existing, "TXT", txt.name, zone.name, txt.content);
    if (match) {
      await updateDnsRecord(auth, zone.id, match.id, {
        type: "TXT",
        name: txt.name,
        content: txt.content,
        proxied: false,
        ttl: 1,
      });
      updated += 1;
    } else {
      await createDnsRecord(auth, zone.id, {
        type: "TXT",
        name: txt.name,
        content: txt.content,
        proxied: false,
        ttl: 1,
      });
      created += 1;
    }
  }

  return { created, updated };
}

function findDns(
  records: CfDnsRecord[],
  type: string,
  name: string,
  zoneName: string,
  content?: string,
): CfDnsRecord | undefined {
  return records.find((r) => {
    if (r.type !== type) return false;
    if (!recordNameMatches(r.name, name, zoneName)) return false;
    if (content && r.content.replace(/^"|"$/g, "") !== content) return false;
    return true;
  });
}
