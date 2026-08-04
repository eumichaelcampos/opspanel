"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { apiFetch } from "@/lib/api";

export default function ProfileSettingsPage() {
  const qc = useQueryClient();
  const { data: me, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: () =>
      apiFetch<{
        user: { email: string; name?: string | null; role: string; organizationName?: string };
      }>("/me"),
  });

  const [name, setName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (me?.user && !initialized) {
      setName(me.user.name ?? "");
      setInitialized(true);
    }
  }, [me, initialized]);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ user: { name?: string | null } }>("/me", {
        method: "PATCH",
        body: JSON.stringify({
          name: name.trim() || undefined,
          ...(newPassword ? { password: newPassword, currentPassword } : {}),
        }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["me"] });
      setCurrentPassword("");
      setNewPassword("");
    },
  });

  return (
    <AppShell title="Perfil">
      {isLoading ? <p className="text-muted">Carregando...</p> : null}
      <div className="mx-auto max-w-lg space-y-6">
        <section className="glass-card space-y-4 p-5">
          <h2 className="font-semibold">Dados pessoais</h2>
          <div>
            <label className="mb-1 block text-sm text-muted">E-mail</label>
            <input className="w-full rounded-card border bg-white/70 px-3 py-2 text-sm" value={me?.user.email ?? ""} disabled />
          </div>
          <div>
            <label className="mb-1 block text-sm text-muted">Nome de exibição</label>
            <input
              className="w-full rounded-card border bg-white px-3 py-2 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <p className="text-xs text-muted">
            Organização: {me?.user.organizationName ?? "—"} · Papel: {me?.user.role ?? "—"}
          </p>
        </section>

        <section className="glass-card space-y-4 p-5">
          <h2 className="font-semibold">Alterar senha</h2>
          <div>
            <label className="mb-1 block text-sm text-muted">Senha atual</label>
            <input
              type="password"
              className="w-full rounded-card border bg-white px-3 py-2 text-sm"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-muted">Nova senha</label>
            <input
              type="password"
              className="w-full rounded-card border bg-white px-3 py-2 text-sm"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
        </section>

        {saveMutation.error ? (
          <p className="text-sm text-danger">{(saveMutation.error as Error).message}</p>
        ) : null}
        {saveMutation.isSuccess ? <p className="text-sm text-success">Perfil atualizado.</p> : null}

        <button
          type="button"
          disabled={saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
          className="rounded-card bg-accent px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
        >
          {saveMutation.isPending ? "Salvando..." : "Salvar alterações"}
        </button>
      </div>
    </AppShell>
  );
}
