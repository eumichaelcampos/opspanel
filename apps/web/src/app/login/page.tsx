"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Hexagon } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { ThemeToggle } from "@/components/theme-toggle";

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
    <div className="relative flex min-h-screen items-center justify-center p-6">
      <div className="absolute right-5 top-5">
        <ThemeToggle />
      </div>
      <form onSubmit={onSubmit} className="glass-panel w-full max-w-md space-y-4 p-8">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/15 text-accent">
            <Hexagon className="h-5 w-5" strokeWidth={2.2} />
          </div>
          <div>
            <p className="text-xs uppercase tracking-widest text-muted">OpsPanel</p>
            <h1 className="text-2xl font-semibold text-ink">Entrar</h1>
          </div>
        </div>
        {error ? <p className="rounded-card bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p> : null}
        <label className="block space-y-1 text-sm">
          <span className="text-muted">E-mail</span>
          <input
            className="w-full rounded-card border px-3 py-2 focus:outline-none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            required
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-muted">Senha</span>
          <input
            className="w-full rounded-card border px-3 py-2 focus:outline-none"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            required
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-card bg-accent px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60 dark:shadow-glow-accent"
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
