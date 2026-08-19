import { z } from "zod";

export type DnsAuthStatus = "ok" | "missing" | "invalid" | "unknown";

export type EmailHealthReport = {
  domain: string;
  spf: DnsAuthStatus;
  dkim: DnsAuthStatus;
  dmarc: DnsAuthStatus;
  mx: DnsAuthStatus;
  details: {
    spfRecord?: string;
    dkimSelectors?: string[];
    dmarcRecord?: string;
    mxHosts?: string[];
  };
  checkedAt: string;
};

export type EmailDnsRecord = {
  type: "MX" | "TXT";
  name: string;
  content: string;
  priority?: number;
};

export type EmailDnsBundle = {
  mx: { priority: number; host: string }[];
  txt: EmailDnsRecord[];
};

export const emailMailboxCreateSchema = z.object({
  localPart: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9._+-]+$/i, "Use apenas letras, números e . _ + -"),
  displayName: z.string().max(120).optional(),
  quotaMb: z.number().int().min(512).max(102_400).optional(),
  password: z.string().min(8).max(128).optional(),
});

export const emailSmtpProfileSchema = z.object({
  fromAddress: z.string().email().max(200),
  fromName: z.string().max(120).optional(),
});

export const emailSmtpTestSchema = z.object({
  to: z.string().email().max(200),
});
