"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, Plug, Server } from "lucide-react";
import { JobTracker } from "@/components/job-tracker";
import { SecretField } from "@/components/secret-field";
import { apiFetch } from "@/lib/api";

type ServerCredential = {
  host: string;
  port: number;
  username: string;
  type: "ssh_password" | "ssh_private_key";
  password?: string;
  privateKey?: string;
};

export function ServerAccessPanel({
  serverId,
  enabled,
}: {
  serverId: string;
  enabled: boolean;
}) {
  const qc = useQueryClient();
  const [testJobId, setTestJobId] = useState<string | null>(null);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["server-credential", serverId],
    queryFn: () => apiFetch<ServerCredential>(`/servers/${serverId}/credential`),
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  const [editPort, setEditPort] = useState<string | null>(null);
  const [portMsg, setPortMsg] = useState<string | null>(null);

  const savePort = useMutation({
    mutationFn: (port: number) =>
      apiFetch<{ host: string; port: number }>(`/servers/${serverId}/connection`, {
        method: "PATCH",
        body: JSON.stringify({ port }),
      }),
    onSuccess: () => {
      setPortMsg("Porta SSH atualizada.");
      setEditPort(null);
      void qc.invalidateQueries({ queryKey: ["server", serverId] });
      void qc.invalidateQueries({ queryKey: ["server-credential", serverId] });
    },
    onError: (err: Error) => setPortMsg(err.message),
  });

  const testConnection = useMutation({
    mutationFn: () => apiFetch<{ jobId: string }>(`/servers/${serverId}/test-connection`, { method: "POST" }),
    onSuccess: (r) => {
      setPortMsg(null);
      setTestJobId(r.jobId);
    },
    onError: (err: Error) => setPortMsg(err.message),
  });

  if (!enabled) return null;

  const displayPort = editPort ?? String(data?.port ?? 22);
  const isHostGatorHint = data?.port === 22022;

  return (
    <section className="glass-card space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-accent" />
          <h2 className="text-sm font-semibold">Acesso SSH</h2>
        </div>
        <button
          type="button"
          disabled={testConnection.isPending}
          onClick={() => testConnection.mutate()}
          className="inline-flex items-center gap-1 rounded-card border border-white/80 bg-white px-2.5 py-1 text-xs text-muted hover:bg-white/90 disabled:opacity-50"
        >
          {testConnection.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plug className="h-3 w-3" />}
          Testar conexão
        </button>
      </div>

      {isHostGatorHint ? (
        <p className="rounded-md border border-accent/20 bg-accent/5 px-3 py-2 text-xs text-muted">
          HostGator/VPS usa porta SSH <strong className="font-mono">22022</strong>, não 22. Confirme se bate com o painel
          do provedor.
        </p>
      ) : null}

      {isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando credenciais…
        </p>
      ) : null}

      {isError ? <p className="text-sm text-danger">{(error as Error).message}</p> : null}

      {data ? (
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted">Host</dt>
            <dd className="font-mono text-xs">{data.host}</dd>
          </div>
          <div>
            <dt className="text-muted">Porta SSH</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <input
                type="number"
                min={1}
                max={65535}
                value={displayPort}
                onChange={(e) => setEditPort(e.target.value)}
                className="w-24 rounded border border-white/80 bg-white/90 px-2 py-1 font-mono text-xs"
              />
              {editPort != null && editPort !== String(data.port) ? (
                <button
                  type="button"
                  disabled={savePort.isPending}
                  onClick={() => savePort.mutate(Number(editPort))}
                  className="rounded bg-accent px-2 py-1 text-xs text-white hover:bg-accent/90 disabled:opacity-50"
                >
                  Salvar
                </button>
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Usuário</dt>
            <dd className="font-mono text-xs">{data.username}</dd>
          </div>
          <div>
            <dt className="text-muted">Autenticação</dt>
            <dd className="text-xs">{data.type === "ssh_password" ? "Senha" : "Chave privada"}</dd>
          </div>
          {data.password ? (
            <div className="sm:col-span-2">
              <dt className="mb-1 text-muted">Senha</dt>
              <dd>
                <SecretField value={data.password} />
              </dd>
            </div>
          ) : null}
          {data.privateKey ? (
            <div className="sm:col-span-2">
              <dt className="mb-1 flex items-center gap-1 text-muted">
                <KeyRound className="h-3 w-3" />
                Chave privada
              </dt>
              <dd>
                <SecretField value={data.privateKey} multiline />
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {portMsg ? <p className="text-xs text-muted">{portMsg}</p> : null}

      {testJobId ? (
        <JobTracker
          jobId={testJobId}
          onComplete={() => {
            setTestJobId(null);
            void qc.invalidateQueries({ queryKey: ["server", serverId] });
          }}
        />
      ) : null}

      <p className="text-[11px] text-muted">
        Comando:{" "}
        <code className="rounded bg-white/80 px-1 py-0.5 font-mono text-[10px]">
          ssh {data?.username ?? "user"}@{data?.host ?? "host"} -p {data?.port ?? displayPort}
        </code>
      </p>
    </section>
  );
}
