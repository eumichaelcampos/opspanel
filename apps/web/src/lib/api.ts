/**
 * No browser usamos same-origin (/api/v1) via rewrite do Next.js,
 * para o cookie de sessão ser gravado em localhost:3000.
 */
function getApiBase(): string {
  // No browser, sempre same-origin (/api/v1 via rewrite) para o cookie de sessão ir junto.
  if (typeof window !== "undefined") {
    return "";
  }
  return process.env.NEXT_PUBLIC_API_URL ?? process.env.API_URL ?? "http://localhost:3001";
}

export function apiUrl(path: string): string {
  const base = getApiBase();
  return `${base}/api/v1${path}`;
}

/** WebSocket direto na API (Next.js não faz proxy de WS). */
export function wsUrl(path: string): string {
  const base =
    getApiBase() ||
    (typeof window !== "undefined"
      ? `${window.location.protocol}//${window.location.hostname}:3001`
      : "http://localhost:3001");
  const wsBase = base.replace(/^http/i, "ws");
  return `${wsBase}/api/v1${path}`;
}

function parseApiErrorMessage(status: number, rawBody: string): string {
  try {
    const body = JSON.parse(rawBody) as { error?: { message?: string }; message?: string };
    if (body?.error?.message) return body.error.message;
    if (body?.message && body.message !== "Internal server error") return body.message;
  } catch {
    /* resposta não-JSON (ex.: proxy Next com API offline) */
  }
  if (status === 401) return "Sessão inválida ou expirada.";
  if (status === 429) return "Muitas requisições. Aguarde alguns segundos e recarregue a página.";
  if (status >= 500) {
    return "API indisponível. Aguarde alguns segundos e tente de novo (backend na porta 3001).";
  }
  return "Erro na requisição";
}

function redirectToLogin(): void {
  if (typeof window === "undefined") return;
  if (window.location.pathname.startsWith("/login")) return;
  window.location.href = "/login?logout=1";
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      ...init,
      credentials: "include",
      headers,
    });
  } catch {
    throw new Error(
      "Não foi possível conectar à API. Verifique se api (3001) e worker estão rodando.",
    );
  }

  if (!res.ok) {
    const rawBody = await res.text().catch(() => "");
    const message = parseApiErrorMessage(res.status, rawBody);
    if (res.status === 401 && typeof window !== "undefined") {
      redirectToLogin();
    }
    throw new Error(message);
  }

  return res.json() as Promise<T>;
}

function parseApiErrorFromResponse(status: number, rawBody: string): string {
  return parseApiErrorMessage(status, rawBody);
}

/** Download autenticado (cookie de sessão) — evita window.open sem credenciais. */
export async function apiDownload(path: string, filename?: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), { credentials: "include" });
  } catch {
    throw new Error("Não foi possível conectar à API para download.");
  }
  if (!res.ok) {
    const rawBody = await res.text().catch(() => "");
    if (res.status === 401 && typeof window !== "undefined") redirectToLogin();
    throw new Error(parseApiErrorFromResponse(res.status, rawBody));
  }
  const blob = await res.blob();
  const headerName = res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1];
  const name = filename ?? headerName ?? "download";
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Upload multipart com cookie de sessão. */
export async function apiUpload(path: string, form: FormData): Promise<void> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), { method: "POST", credentials: "include", body: form });
  } catch {
    throw new Error("Não foi possível conectar à API para upload.");
  }
  if (!res.ok) {
    const rawBody = await res.text().catch(() => "");
    if (res.status === 401 && typeof window !== "undefined") redirectToLogin();
    throw new Error(parseApiErrorFromResponse(res.status, rawBody));
  }
}

export const API_URL = getApiBase();
