"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

const DEFAULT_LICENSE_SERVER_URL =
  process.env.NEXT_PUBLIC_LICENSE_SERVER_URL ?? "https://license.michaelcampos.com.br";

type SetupStatus = {
  needsSetup: boolean;
  completed: boolean;
  hasUsers: boolean;
  licenseConfigured: boolean;
  cloudConfigured: boolean;
  licenseServerUrl: string | null;
};

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [orgName, setOrgName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminName, setAdminName] = useState("");
  const [licenseServerUrl, setLicenseServerUrl] = useState(DEFAULT_LICENSE_SERVER_URL);
  const [licenseKey, setLicenseKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["setup", "status"],
    queryFn: () => apiFetch<{ setup: SetupStatus }>("/setup/status"),
  });

  useEffect(() => {
    if (data?.setup.licenseServerUrl) {
      setLicenseServerUrl(data.setup.licenseServerUrl);
    }
  }, [data?.setup.licenseServerUrl]);

  const registerMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: boolean; licenseKey: string; plan: string }>("/setup/register-license", {
        method: "POST",
        body: JSON.stringify({ email: adminEmail, licenseServerUrl }),
      }),
    onSuccess: (res) => {
      setLicenseKey(res.licenseKey);
      setStep(3);
      setError(null);
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Falha ao obter licença"),
  });

  const completeMutation = useMutation({
    mutationFn: () =>
      apiFetch("/setup/complete", {
        method: "POST",
        body: JSON.stringify({
          organizationName: orgName,
          adminEmail,
          adminPassword,
          adminName: adminName || undefined,
          licenseKey,
          licenseServerUrl: licenseServerUrl || undefined,
        }),
      }),
    onSuccess: async () => {
      await apiFetch("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: adminEmail, password: adminPassword }),
      });
      router.push("/dashboard");
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Falha no setup"),
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-muted">Verificando instalação…</p>
      </div>
    );
  }

  if (data && !data.setup.needsSetup && data.setup.completed) {
    router.replace("/login");
    return null;
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="glass-panel w-full max-w-lg space-y-6 p-8">
        <div>
          <p className="text-xs uppercase tracking-widest text-accent">OpsPanel</p>
          <h1 className="text-2xl font-semibold text-ink">Configuração inicial</h1>
          <p className="mt-1 text-sm text-muted">
            Instalação self-hosted. Conecte sua licença free ao License Cloud para ativar o painel.
          </p>
        </div>

        <div className="flex gap-2 text-xs">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className={`flex-1 rounded-full py-1 text-center ${step >= n ? "bg-accent text-white" : "bg-white/60 text-muted"}`}
            >
              {n === 1 ? "Conta" : n === 2 ? "Licença" : "Confirmar"}
            </div>
          ))}
        </div>

        {error ? <p className="rounded-card bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p> : null}

        {step === 1 ? (
          <div className="space-y-4">
            <label className="block space-y-1 text-sm">
              <span className="text-muted">Nome da organização</span>
              <input
                className="w-full rounded-card border border-white/80 bg-white/90 px-3 py-2"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="Minha agência"
                required
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="text-muted">Seu nome</span>
              <input
                className="w-full rounded-card border border-white/80 bg-white/90 px-3 py-2"
                value={adminName}
                onChange={(e) => setAdminName(e.target.value)}
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="text-muted">E-mail admin</span>
              <input
                className="w-full rounded-card border border-white/80 bg-white/90 px-3 py-2"
                type="email"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                required
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="text-muted">Senha (mín. 8 caracteres)</span>
              <input
                className="w-full rounded-card border border-white/80 bg-white/90 px-3 py-2"
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                required
              />
            </label>
            <button
              type="button"
              className="w-full rounded-card bg-accent px-4 py-2.5 text-sm font-medium text-white"
              disabled={!orgName || !adminEmail || adminPassword.length < 8}
              onClick={() => setStep(2)}
            >
              Continuar
            </button>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-4">
            <label className="block space-y-1 text-sm">
              <span className="text-muted">License Cloud URL</span>
              <input
                className="w-full rounded-card border border-white/80 bg-white/90 px-3 py-2 font-mono text-xs"
                value={licenseServerUrl}
                onChange={(e) => setLicenseServerUrl(e.target.value)}
                placeholder="https://license.michaelcampos.com.br"
              />
            </label>
            <div className="rounded-card border border-white/80 bg-white/60 p-4 text-sm text-muted">
              <p className="font-medium text-ink">Obter licença free automaticamente</p>
              <p className="mt-1">Registra seu e-mail no License Cloud e gera a chave `oplic_...`.</p>
              <button
                type="button"
                className="mt-3 w-full rounded-card bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                disabled={registerMutation.isPending || !adminEmail}
                onClick={() => registerMutation.mutate()}
              >
                {registerMutation.isPending ? "Gerando licença…" : "Gerar licença free"}
              </button>
            </div>
            <div className="text-center text-xs text-muted">ou cole uma chave existente</div>
            <label className="block space-y-1 text-sm">
              <span className="text-muted">LICENSE_KEY</span>
              <input
                className="w-full rounded-card border border-white/80 bg-white/90 px-3 py-2 font-mono text-xs"
                value={licenseKey}
                onChange={(e) => setLicenseKey(e.target.value)}
                placeholder="oplic_live_..."
              />
            </label>
            <div className="flex gap-2">
              <button type="button" className="rounded-card border px-3 py-2 text-sm" onClick={() => setStep(1)}>
                Voltar
              </button>
              <button
                type="button"
                className="flex-1 rounded-card bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                disabled={licenseKey.length < 20}
                onClick={() => setStep(3)}
              >
                Continuar
              </button>
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-4 text-sm">
            <div className="rounded-card border border-white/80 bg-white/60 p-4 space-y-2">
              <p><span className="text-muted">Organização:</span> {orgName}</p>
              <p><span className="text-muted">Admin:</span> {adminEmail}</p>
              <p><span className="text-muted">License Cloud:</span> {licenseServerUrl || "—"}</p>
              <p className="truncate font-mono text-xs"><span className="text-muted">Licença:</span> {licenseKey.slice(0, 20)}…</p>
            </div>
            <p className="text-xs text-muted">
              Ao concluir, esta instância enviará heartbeat ao License Cloud. Você administra assinantes no portal publisher (:3004).
            </p>
            <div className="flex gap-2">
              <button type="button" className="rounded-card border px-3 py-2 text-sm" onClick={() => setStep(2)}>
                Voltar
              </button>
              <button
                type="button"
                className="flex-1 rounded-card bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                disabled={completeMutation.isPending}
                onClick={() => completeMutation.mutate()}
              >
                {completeMutation.isPending ? "Ativando…" : "Concluir e entrar"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
