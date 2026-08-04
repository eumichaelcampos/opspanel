/**
 * No browser usamos same-origin (/api/v1) via rewrite do Next.js,
 * para o cookie de sessão ser gravado em localhost:3000.
 */
function getApiBase(): string {
  if (typeof window !== "undefined") {
    return process.env.NEXT_PUBLIC_API_URL ?? "";
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
    const body = JSON.parse(rawBody) as { error?: { message?: string } };
    if (body?.error?.message) return body.error.message;
  } catch {
    /* resposta não-JSON (ex.: proxy Next com API offline) */
  }
  if (status === 401) return "Sessão inválida ou expirada.";
  if (status >= 500) {
    return "API indisponível. Aguarde alguns segundos e tente de novo (backend na porta 3001).";
  }
  return "Erro na requisição";
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
      window.location.href = "/login";
    }
    throw new Error(message);
  }

  return res.json() as Promise<T>;
}

export const API_URL = getApiBase();
