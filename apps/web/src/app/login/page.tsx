"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await apiFetch("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no login");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={onSubmit} className="glass-panel w-full max-w-md space-y-4 p-8">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted">OpsPanel</p>
          <h1 className="text-2xl font-semibold text-ink">Entrar</h1>
        </div>
        {error ? <p className="rounded-card bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p> : null}
        <label className="block space-y-1 text-sm">
          <span className="text-muted">E-mail</span>
          <input
            className="w-full rounded-card border border-white/80 bg-white/90 px-3 py-2"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            required
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-muted">Senha</span>
          <input
            className="w-full rounded-card border border-white/80 bg-white/90 px-3 py-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            required
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-card bg-accent px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
        >
          {loading ? "Entrando..." : "Entrar"}
        </button>
        {process.env.NODE_ENV === "development" ? (
          <p className="text-center text-xs text-muted">
            Dev: use as credenciais do seed em <code className="text-[10px]">.env</code>
          </p>
        ) : null}
      </form>
    </div>
  );
}
