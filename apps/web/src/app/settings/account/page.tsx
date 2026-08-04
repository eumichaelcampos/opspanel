"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { apiFetch } from "@/lib/api";
import { Copy, Trash2 } from "lucide-react";

type ApiKeyRow = {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt?: string | null;
};

export default function AccountSettingsPage() {
  const qc = useQueryClient();
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["api-keys"],
    queryFn: () => apiFetch<{ keys: ApiKeyRow[] }>("/api-keys"),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ key: string; name: string }>("/api-keys", {
        method: "POST",
        body: JSON.stringify({ name: newKeyName.trim() }),
      }),
    onSuccess: (r) => {
      setCreatedKey(r.key);
      setNewKeyName("");
      void qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (keyId: string) => apiFetch(`/api-keys/${keyId}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["api-keys"] }),
  });

  const mcpConfig = `{
  "mcpServers": {
    "opspanel": {
      "command": "npx",
      "args": ["-y", "@opspanel/mcp-server"],
      "env": {
        "OPSPANEL_API_URL": "http://localhost:3001",
        "OPSPANEL_API_KEY": "opk_sua_chave_aqui"
      }
    }
  }
}`;

  return (
    <AppShell title="Conta & API">
      <div className="mx-auto max-w-2xl space-y-8">
        <section className="glass-card space-y-4 p-5">
          <h2 className="font-semibold">Chaves de API</h2>
          <p className="text-sm text-muted">
            Use chaves para integrar Cursor, Claude Desktop ou automações externas via MCP server.
          </p>

          {createdKey ? (
            <div className="rounded-card border border-success/40 bg-success/5 p-4 text-sm">
              <p className="font-medium text-success">Chave criada (copie agora, não será exibida novamente)</p>
              <code className="mt-2 block break-all rounded bg-white/80 p-2 font-mono text-xs">{createdKey}</code>
              <button
                type="button"
                className="mt-2 inline-flex items-center gap-1 text-xs text-accent"
                onClick={() => void navigator.clipboard.writeText(createdKey)}
              >
                <Copy className="h-3 w-3" /> Copiar
              </button>
            </div>
          ) : null}

          <div className="flex gap-2">
            <input
              className="flex-1 rounded-card border bg-white px-3 py-2 text-sm"
              placeholder="Nome da chave (ex: Cursor dev)"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
            />
            <button
              type="button"
              disabled={newKeyName.trim().length < 2 || createMutation.isPending}
              onClick={() => createMutation.mutate()}
              className="rounded-card bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              Gerar chave
            </button>
          </div>

          {isLoading ? <p className="text-muted text-sm">Carregando...</p> : null}
          <ul className="space-y-2">
            {data?.keys.map((k) => (
              <li key={k.id} className="flex items-center justify-between rounded-card bg-white/80 px-3 py-2 text-sm">
                <div>
                  <p className="font-medium">{k.name}</p>
                  <p className="font-mono text-xs text-muted">{k.keyPrefix}…</p>
                </div>
                <button
                  type="button"
                  className="text-danger hover:opacity-80"
                  title="Revogar"
                  onClick={() => {
                    if (window.confirm(`Revogar chave "${k.name}"?`)) revokeMutation.mutate(k.id);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
          {createMutation.error ? (
            <p className="text-sm text-danger">{(createMutation.error as Error).message}</p>
          ) : null}
        </section>

        <section className="glass-card space-y-3 p-5">
          <h2 className="font-semibold">Configurar MCP no Cursor</h2>
          <p className="text-sm text-muted">
            Adicione ao arquivo <code className="text-xs">.cursor/mcp.json</code> ou configurações MCP do seu cliente:
          </p>
          <pre className="overflow-x-auto rounded-card bg-ink/5 p-4 text-xs">{mcpConfig}</pre>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-sm text-accent"
            onClick={() => void navigator.clipboard.writeText(mcpConfig)}
          >
            <Copy className="h-4 w-4" /> Copiar configuração
          </button>
        </section>
      </div>
    </AppShell>
  );
}
