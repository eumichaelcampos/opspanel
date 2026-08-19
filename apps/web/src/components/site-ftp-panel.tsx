"use client";

import { useMutation } from "@tanstack/react-query";
import {
  CheckCircle2,
  CircleHelp,
  Eye,
  EyeOff,
  Loader2,
  Trash2,
  XCircle,
} from "lucide-react";
import { useCallback, useState } from "react";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";

type StackComponent = { id: string; installed: boolean; running: boolean; status: string };

type FtpUser = {
  id: string;
  username: string;
  homePath: string;
  createdAt: string;
  hasPassword: boolean;
};

type Props = {
  siteId: string;
  domain: string;
  serverId: string;
  serverHost: string;
  serverPort: number;
  ftpUsers: FtpUser[];
  stackComponents: StackComponent[];
  actionsDisabled?: boolean;
  onJobStarted: (jobId: string) => void;
  onRefresh: () => void;
};

type FtpFeedback = {
  type: "success" | "error" | "info";
  title: string;
  detail?: string;
};

let ftpJobResultHandler: ((operationKey: string, status: string, result?: {
  username?: string;
  password?: string;
  host?: string;
  errorMessage?: string | null;
}) => void) | null = null;

export function notifySiteFtpJobResult(
  operationKey: string,
  status: string,
  result?: { username?: string; password?: string; host?: string; errorMessage?: string | null },
) {
  ftpJobResultHandler?.(operationKey, status, result);
}

export function SiteFtpPanel({
  siteId,
  domain,
  serverId,
  serverHost,
  serverPort,
  ftpUsers,
  stackComponents,
  actionsDisabled = false,
  onJobStarted,
  onRefresh,
}: Props) {
  const [ftpUser, setFtpUser] = useState("");
  const [ftpPass, setFtpPass] = useState("");
  const [feedback, setFeedback] = useState<FtpFeedback | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [revealingId, setRevealingId] = useState<string | null>(null);

  const proftpd = stackComponents.find((c) => c.id === "proftpd");
  const proftpdReady = Boolean(proftpd?.installed && proftpd?.running);
  const proftpdUnknown = stackComponents.length === 0;

  const handleJobResult = useCallback(
    (operationKey: string, status: string, result?: { username?: string; password?: string; host?: string; errorMessage?: string | null }) => {
      if (operationKey === "site.ftp.user.create") {
        if (status === "succeeded" && result?.username) {
          setFeedback({
            type: "success",
            title: `Usuário FTP "${result.username}" criado`,
            detail: `Host: ${result.host ?? serverHost} · Senha disponível na listagem (ícone olho).`,
          });
          setFtpUser("");
          setFtpPass("");
          onRefresh();
        } else if (status === "failed") {
          const detail = result?.errorMessage?.replace(/\u001b\[[0-9;]*m/g, "").trim();
          setFeedback({
            type: "error",
            title: "Falha ao criar usuário FTP",
            detail: detail ?? "Verifique o job para detalhes.",
          });
        }
      }
      if (operationKey === "site.ftp.user.delete") {
        if (status === "succeeded") {
          setFeedback({ type: "success", title: "Usuário FTP excluído" });
          setRevealed({});
          onRefresh();
        } else if (status === "failed") {
          setFeedback({ type: "error", title: "Falha ao excluir usuário FTP", detail: result?.errorMessage ?? undefined });
        }
      }
    },
    [onRefresh, serverHost],
  );

  ftpJobResultHandler = handleJobResult;

  const serverHealthMutation = useMutation({
    mutationFn: () => apiFetch<{ jobId: string }>(`/servers/${serverId}/health`, { method: "POST" }),
    onSuccess: (r) => onJobStarted(r.jobId),
    onError: (err: Error) => setFeedback({ type: "error", title: "Falha ao detectar stack", detail: err.message }),
  });

  const ftpMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ jobId: string }>(`/sites/${siteId}/ftp-users`, {
        method: "POST",
        body: JSON.stringify({
          username: ftpUser.trim(),
          password: ftpPass.trim() || undefined,
          ensureProftpd: true,
        }),
      }),
    onSuccess: (r) => {
      setFeedback({
        type: "info",
        title: "Criando usuário FTP…",
        detail: "ProFTPd será ligado automaticamente se necessário.",
      });
      onJobStarted(r.jobId);
    },
    onError: (err: Error) => setFeedback({ type: "error", title: "Não foi possível iniciar a criação", detail: err.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: (ftpUserId: string) =>
      apiFetch<{ jobId: string }>(`/sites/${siteId}/ftp-users/${ftpUserId}`, { method: "DELETE" }),
    onSuccess: (r) => {
      setFeedback({ type: "info", title: "Excluindo usuário FTP…" });
      onJobStarted(r.jobId);
    },
    onError: (err: Error) => setFeedback({ type: "error", title: "Falha ao excluir", detail: err.message }),
  });

  const revealPassword = useCallback(async (ftpUserId: string) => {
    if (revealed[ftpUserId]) {
      setRevealed((prev) => {
        const next = { ...prev };
        delete next[ftpUserId];
        return next;
      });
      return;
    }
    setRevealingId(ftpUserId);
    try {
      const data = await apiFetch<{ password: string }>(`/sites/${siteId}/ftp-users/${ftpUserId}/password`);
      setRevealed((prev) => ({ ...prev, [ftpUserId]: data.password }));
    } catch (err) {
      setFeedback({
        type: "error",
        title: "Senha indisponível",
        detail: err instanceof Error ? err.message : "Erro ao obter senha",
      });
    } finally {
      setRevealingId(null);
    }
  }, [revealed, siteId]);

  return (
    <section className="glass-card space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Usuários FTP</h2>
          <p className="text-xs text-muted">ProFTPd no servidor · criação liga o serviço automaticamente</p>
        </div>
        <div className="flex items-center gap-2">
          {proftpd ? (
            <span
              className={cn(
                "rounded-full px-2 py-1 text-xs",
                proftpdReady ? "bg-success/15 text-success" : proftpd.installed ? "bg-warning/15 text-warning" : "bg-white/80 text-muted",
              )}
            >
              ProFTPd: {!proftpd.installed ? "não instalado" : proftpd.running ? "rodando" : "instalado, parado"}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="inline-flex items-center gap-1 rounded-card border border-white/80 bg-white/80 px-2.5 py-1 text-xs text-muted hover:text-ink"
          >
            <CircleHelp className="h-3.5 w-3.5" />
            Como conectar
          </button>
        </div>
      </div>

      {proftpdUnknown ? (
        <div className="rounded-card border border-blue-200 bg-blue-50/80 px-4 py-3 text-sm text-blue-900">
          Status do ProFTPd desconhecido.{" "}
          <button
            type="button"
            disabled={actionsDisabled || serverHealthMutation.isPending}
            onClick={() => serverHealthMutation.mutate()}
            className="font-medium text-accent underline disabled:opacity-60"
          >
            Detectar stack do servidor
          </button>
        </div>
      ) : null}

      {feedback ? (
        <div
          className={cn(
            "flex gap-2 rounded-card border px-4 py-3 text-sm",
            feedback.type === "success" && "border-success/30 bg-success/10 text-success",
            feedback.type === "error" && "border-danger/30 bg-danger/10 text-danger",
            feedback.type === "info" && "border-accent/30 bg-accent/5 text-ink",
          )}
        >
          {feedback.type === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : null}
          {feedback.type === "error" ? <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> : null}
          {feedback.type === "info" ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" /> : null}
          <div>
            <p className="font-medium">{feedback.title}</p>
            {feedback.detail ? <p className="mt-0.5 text-xs opacity-90">{feedback.detail}</p> : null}
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <input
          className="rounded-card border border-ink/20 bg-white/90 px-3 py-2 text-sm focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
          placeholder="Usuário FTP"
          value={ftpUser}
          disabled={actionsDisabled}
          onChange={(e) => setFtpUser(e.target.value)}
        />
        <input
          className="rounded-card border border-ink/20 bg-white/90 px-3 py-2 text-sm focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
          placeholder="Senha (opcional, gera automaticamente)"
          type="password"
          value={ftpPass}
          disabled={actionsDisabled}
          onChange={(e) => setFtpPass(e.target.value)}
        />
        <button
          type="button"
          disabled={!ftpUser.trim() || actionsDisabled || ftpMutation.isPending}
          onClick={() => ftpMutation.mutate()}
          className="rounded-card bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {ftpMutation.isPending ? "Iniciando…" : "Adicionar usuário FTP"}
        </button>
      </div>

      {!proftpdReady && !proftpdUnknown ? (
        <p className="text-xs text-muted">ProFTPd será instalado/iniciado automaticamente ao criar o usuário.</p>
      ) : null}

      {ftpUsers.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-white/20">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/40 text-xs text-muted">
                <th className="px-3 py-2 font-medium">Usuário</th>
                <th className="hidden px-3 py-2 font-medium sm:table-cell">Diretório</th>
                <th className="px-3 py-2 font-medium">Senha</th>
                <th className="px-3 py-2 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {ftpUsers.map((u) => (
                <tr key={u.id} className="border-b border-white/5 last:border-0">
                  <td className="px-3 py-2 font-mono text-xs">{u.username}</td>
                  <td className="hidden px-3 py-2 font-mono text-[10px] text-muted sm:table-cell">{u.homePath}</td>
                  <td className="px-3 py-2">
                    {u.hasPassword ? (
                      <span className="inline-flex items-center gap-2 font-mono text-xs">
                        {revealed[u.id] ? revealed[u.id] : "••••••••"}
                        <button
                          type="button"
                          title={revealed[u.id] ? "Ocultar senha" : "Mostrar senha"}
                          disabled={revealingId === u.id}
                          onClick={() => void revealPassword(u.id)}
                          className="rounded p-0.5 text-muted hover:text-accent"
                        >
                          {revealingId === u.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : revealed[u.id] ? (
                            <EyeOff className="h-3.5 w-3.5" />
                          ) : (
                            <Eye className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </span>
                    ) : (
                      <span className="text-xs text-muted">não armazenada</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      disabled={actionsDisabled || deleteMutation.isPending}
                      onClick={() => {
                        if (window.confirm(`Excluir usuário FTP "${u.username}"?`)) deleteMutation.mutate(u.id);
                      }}
                      className="rounded p-1 text-muted hover:bg-white/10 hover:text-danger disabled:opacity-50"
                      title="Excluir"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted">Nenhum usuário FTP cadastrado pelo painel.</p>
      )}

      {helpOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-white/20 bg-[#0d1117] p-6 text-sm text-white shadow-xl">
            <h3 className="text-lg font-semibold">Como conectar via FTP</h3>
            <p className="mt-2 text-white/70">Use FileZilla, WinSCP ou Cyberduck com os dados abaixo.</p>
            <dl className="mt-4 space-y-2 font-mono text-xs">
              <div className="rounded-lg bg-white/5 px-3 py-2">
                <dt className="text-white/50">Host / Servidor</dt>
                <dd>{serverHost}</dd>
              </div>
              <div className="rounded-lg bg-white/5 px-3 py-2">
                <dt className="text-white/50">Porta</dt>
                <dd>21 (FTP) · modo passivo se necessário</dd>
              </div>
              <div className="rounded-lg bg-white/5 px-3 py-2">
                <dt className="text-white/50">Usuário / Senha</dt>
                <dd>Criados acima · senha no ícone olho</dd>
              </div>
              <div className="rounded-lg bg-white/5 px-3 py-2">
                <dt className="text-white/50">Diretório remoto</dt>
                <dd>/var/www/{domain}/htdocs</dd>
              </div>
              <div className="rounded-lg bg-white/5 px-3 py-2">
                <dt className="text-white/50">SFTP alternativo</dt>
                <dd>SSH na porta {serverPort} (usuário Linux, não ProFTPd)</dd>
              </div>
            </dl>
            <button
              type="button"
              onClick={() => setHelpOpen(false)}
              className="mt-5 w-full rounded-card bg-accent px-4 py-2 text-sm font-medium text-white"
            >
              Entendi
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
