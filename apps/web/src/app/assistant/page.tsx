"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { apiFetch } from "@/lib/api";
import { CheckCircle2, ExternalLink, Send } from "lucide-react";

type ChatMessage = { role: "user" | "assistant"; content: string };

const STARTER: ChatMessage = {
  role: "assistant",
  content:
    "Olá! Sou o assistente OpsPanel. Posso listar servidores e sites, mostrar o status e criar sites por comando.\n\nPara respostas com GPT, conecte ChatGPT em Conta → Integrações.\n\nExemplo: **criar site wp no servidor SRV-TALLES domínio meusite.com.br**",
};

export default function AssistantPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([STARTER]);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: codex } = useQuery({
    queryKey: ["me-codex"],
    queryFn: () => apiFetch<{ connected: boolean; model?: string }>("/me/openai/codex"),
  });

  const { data: openAi } = useQuery({
    queryKey: ["me-openai"],
    queryFn: () => apiFetch<{ connected: boolean }>("/me/openai"),
  });

  const chatMutation = useMutation({
    mutationFn: (history: ChatMessage[]) =>
      apiFetch<{ reply: string; provider?: string; hint?: string; toolResults?: unknown[] }>("/assistant/chat", {
        method: "POST",
        body: JSON.stringify({ messages: history }),
      }),
    onSuccess: (data) => {
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    },
  });

  function send() {
    const text = input.trim();
    if (!text || chatMutation.isPending) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    chatMutation.mutate(next);
  }

  const aiReady = codex?.connected || openAi?.connected;

  return (
    <AppShell title="Assistente IA">
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        {codex?.connected ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/5 px-3 py-1 text-success">
            <CheckCircle2 className="h-3.5 w-3.5" />
            ChatGPT conectado {codex.model ? `· ${codex.model}` : ""}
          </span>
        ) : openAi?.connected ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/5 px-3 py-1 text-success">
            <CheckCircle2 className="h-3.5 w-3.5" />
            OpenAI API conectada
          </span>
        ) : (
          <Link
            href="/settings/account"
            className="inline-flex items-center gap-1.5 rounded-full border border-ink/15 bg-white/80 px-3 py-1 text-muted hover:text-accent"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Conectar ChatGPT em Conta
          </Link>
        )}
        {!aiReady ? (
          <span className="text-xs text-muted">Sem conexão GPT: respostas em modo local (ferramentas básicas).</span>
        ) : null}
      </div>

      <div className="flex h-[calc(100vh-14rem)] min-h-[420px] flex-col rounded-shell border border-white/70 bg-white/60">
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`max-w-[85%] rounded-card px-4 py-3 text-sm whitespace-pre-wrap ${
                m.role === "user" ? "ml-auto bg-accent text-white" : "bg-white/90 text-ink shadow-sm"
              }`}
            >
              {m.content}
            </div>
          ))}
          {chatMutation.isPending ? (
            <p className="text-sm text-muted">Processando...</p>
          ) : null}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-white/70 p-4">
          {chatMutation.error ? (
            <p className="mb-2 text-sm text-danger">{(chatMutation.error as Error).message}</p>
          ) : null}
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-card border border-ink/20 bg-white px-3 py-2.5 text-sm focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
              placeholder="Ex: listar servidores, criar site wp domínio exemplo.com..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <button
              type="button"
              onClick={send}
              disabled={!input.trim() || chatMutation.isPending}
              className="inline-flex items-center gap-2 rounded-card bg-accent px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
            >
              <Send className="h-4 w-4" />
              Enviar
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">
            Prioridade: ChatGPT conectado ou API key OpenAI. Configure em{" "}
            <Link href="/settings/account" className="text-accent hover:underline">
              Conta → Integrações
            </Link>
            .
          </p>
        </div>
      </div>
    </AppShell>
  );
}
