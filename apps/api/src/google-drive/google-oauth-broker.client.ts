import { googleOAuthBrokerEndpoint } from "@opspanel/config";
import type { GoogleDriveToken } from "./google-oauth";

export type BrokerTokenPayload = Pick<
  GoogleDriveToken,
  "accessToken" | "refreshToken" | "expiresAt" | "email" | "tokenType"
>;

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  return body.error?.message || `OAuth central HTTP ${res.status}`;
}

export async function redeemGoogleOAuthTicket(input: {
  brokerUrl: string;
  ticket: string;
}): Promise<BrokerTokenPayload> {
  const res = await fetch(googleOAuthBrokerEndpoint(input.brokerUrl, "redeem"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket: input.ticket }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const json = (await res.json()) as BrokerTokenPayload;
  if (!json.accessToken || !json.refreshToken || !json.expiresAt) {
    throw new Error("Resposta incompleta do OAuth central.");
  }
  return json;
}

export async function refreshGoogleTokenViaBroker(input: {
  brokerUrl: string;
  refreshToken: string;
  licenseKey?: string;
}): Promise<Pick<GoogleDriveToken, "accessToken" | "expiresAt" | "tokenType">> {
  const res = await fetch(googleOAuthBrokerEndpoint(input.brokerUrl, "refresh"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: input.refreshToken, licenseKey: input.licenseKey }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const json = (await res.json()) as { accessToken?: string; expiresAt?: number; tokenType?: string };
  if (!json.accessToken || !json.expiresAt) {
    throw new Error("Falha ao renovar token no OAuth central.");
  }
  return { accessToken: json.accessToken, expiresAt: json.expiresAt, tokenType: json.tokenType };
}
