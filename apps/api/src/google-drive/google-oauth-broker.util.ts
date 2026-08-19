const COMPLETE_PATH = "/api/v1/me/google-drive/oauth/complete";

export function googleBrokerCompleteUrl(instanceWebUrl: string): string {
  return `${instanceWebUrl.replace(/\/$/, "")}${COMPLETE_PATH}`;
}

export function isAllowedOAuthReturnUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    if (url.username || url.password) return false;
    if (url.hash) return false;
    const path = url.pathname.replace(/\/+$/, "") || "/";
    return path === COMPLETE_PATH;
  } catch {
    return false;
  }
}

export function appendQuery(url: string, params: Record<string, string>): string {
  const next = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    next.searchParams.set(key, value);
  }
  return next.toString();
}
