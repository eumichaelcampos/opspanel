"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { apiFetch } from "@/lib/api";

export default function NewServerPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState("root");
  const [authType, setAuthType] = useState<"ssh_private_key" | "ssh_password">("ssh_password");
  const [privateKey, setPrivateKey] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const credential =
        authType === "ssh_private_key"
          ? { type: authType, username, privateKey }
          : { type: authType, username, password };
      const server = await apiFetch<{ id: string }>("/servers", {
        method: "POST",
        body: JSON.stringify({ name, host, port, credential }),
      });
      router.push(`/servers/${server.id}?setup=1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao cadastrar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell title="Cadastrar servidor">
      <form onSubmit={onSubmit} className="mx-auto max-w-2xl space-y-4">
        {error ? <p className="rounded-card bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p> : null}
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-muted">Nome</span>
            <input className="w-full rounded-card border bg-white/90 px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted">Host</span>
            <input className="w-full rounded-card border bg-white/90 px-3 py-2" value={host} onChange={(e) => setHost(e.target.value)} required />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted">Porta SSH</span>
            <input className="w-full rounded-card border bg-white/90 px-3 py-2" type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted">Usuário SSH</span>
            <input className="w-full rounded-card border bg-white/90 px-3 py-2" value={username} onChange={(e) => setUsername(e.target.value)} required />
          </label>
        </div>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Autenticação</span>
          <select className="w-full rounded-card border bg-white/90 px-3 py-2" value={authType} onChange={(e) => setAuthType(e.target.value as typeof authType)}>
            <option value="ssh_password">Senha</option>
            <option value="ssh_private_key">Chave privada</option>
          </select>
        </label>
        {authType === "ssh_private_key" ? (
          <label className="space-y-1 text-sm">
            <span className="text-muted">Chave privada (PEM/OpenSSH)</span>
            <textarea className="min-h-32 w-full rounded-card border bg-white/90 px-3 py-2 font-mono text-xs" value={privateKey} onChange={(e) => setPrivateKey(e.target.value)} required />
          </label>
        ) : (
          <label className="space-y-1 text-sm">
            <span className="text-muted">Senha SSH</span>
            <input className="w-full rounded-card border bg-white/90 px-3 py-2" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
        )}
        <p className="text-xs text-muted">A credencial é criptografada e não será exibida novamente após o cadastro.</p>
        <button type="submit" disabled={loading} className="rounded-card bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
          {loading ? "Salvando..." : "Salvar servidor"}
        </button>
      </form>
    </AppShell>
  );
}
