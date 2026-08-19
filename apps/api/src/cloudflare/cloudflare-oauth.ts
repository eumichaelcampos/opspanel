import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const CF_OAUTH_AUTH_URL = "https://dash.cloudflare.com/oauth2/auth";
export const CF_OAUTH_TOKEN_URL = "https://dash.cloudflare.com/oauth2/token";
export const CF_OAUTH_REVOKE_URL = "https://dash.cloudflare.com/oauth2/revoke";

const PKCE_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

export type CloudflareOAuthToken = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
};

export type SignedOAuthState = {
  userId: string;
  codeVerifier: string;
  exp: number;
};

function base64url(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf, "utf8") : buf;
  return b.toString("base64url");
}

export function generatePkce(): { codeVerifier: string; codeChallenge: string } {
  const raw = randomBytes(64);
  let verifier = "";
  for (let i = 0; i < 96; i++) {
    verifier += PKCE_CHARSET[raw[i % raw.length]! % PKCE_CHARSET.length]!;
  }
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { codeVerifier: verifier, codeChallenge: challenge };
}

export function signOAuthState(state: SignedOAuthState, secret: string): string {
  const body = base64url(JSON.stringify(state));
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyOAuthState(raw: string, secret: string): SignedOAuthState | null {
  const [body, sig] = raw.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SignedOAuthState;
    if (!parsed.userId || !parsed.codeVerifier || !parsed.exp) return null;
    if (Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function buildCloudflareAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scopes: string[];
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    scope: input.scopes.join(" "),
  });
  return `${CF_OAUTH_AUTH_URL}?${params.toString()}`;
}

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

export async function exchangeCloudflareAuthCode(input: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
}): Promise<CloudflareOAuthToken> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    code: input.code,
    code_verifier: input.codeVerifier,
  });
  const res = await fetch(CF_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(input.clientId, input.clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(parseOAuthError(text) || `Falha na troca do code OAuth (HTTP ${res.status}).`);
  }
  return JSON.parse(text) as CloudflareOAuthToken;
}

export async function refreshCloudflareAccessToken(input: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<CloudflareOAuthToken> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: input.clientId,
    refresh_token: input.refreshToken,
  });
  const res = await fetch(CF_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(input.clientId, input.clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(parseOAuthError(text) || `Falha ao renovar token OAuth (HTTP ${res.status}).`);
  }
  return JSON.parse(text) as CloudflareOAuthToken;
}

function parseOAuthError(text: string): string | null {
  try {
    const json = JSON.parse(text) as { error?: string; error_description?: string };
    if (json.error_description) return json.error_description;
    if (json.error) return json.error;
  } catch {
    /* ignore */
  }
  return null;
}

export function parseOauthScopes(raw: string | undefined): string[] {
  const fallback = "offline_access zone.read dns.write zone_settings.write page_rules.write";
  return (raw || fallback)
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
