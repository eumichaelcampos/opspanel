"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, TerminalSquare, X } from "lucide-react";
import { wsUrl } from "@/lib/api";

type ConsoleState = "idle" | "connecting" | "connected" | "error" | "closed";

export function SshConsolePanel({
  serverId,
  enabled,
  host,
  port,
}: {
  serverId: string;
  enabled: boolean;
  host: string;
  port: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const fitRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ConsoleState>("idle");
  const [status, setStatus] = useState<string | null>(null);

  const sendResize = useCallback(() => {
    const term = termRef.current;
    const ws = wsRef.current;
    if (!term || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
  }, []);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    termRef.current?.dispose();
    termRef.current = null;
    fitRef.current = null;
    setState("closed");
  }, []);

  const connect = useCallback(async () => {
    if (!enabled) return;
    setOpen(true);
    setState("connecting");
    setStatus("Iniciando console…");

    const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
      import("@xterm/xterm"),
      import("@xterm/addon-fit"),
      import("@xterm/addon-web-links"),
    ]);
    await import("@xterm/xterm/css/xterm.css");

    disconnect();

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "Consolas, Menlo, Monaco, 'Courier New', monospace",
      fontSize: 13,
      theme: {
        background: "#0d1117",
        foreground: "#c9d1d9",
        cursor: "#58a6ff",
        selectionBackground: "#264f78",
      },
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    termRef.current = term;
    fitRef.current = fit;

    if (containerRef.current) {
      term.open(containerRef.current);
      fit.fit();
    }

    const ws = new WebSocket(wsUrl(`/servers/${serverId}/terminal`));
    wsRef.current = ws;

    ws.onopen = () => {
      setState("connecting");
      sendResize();
    };

    ws.onmessage = (event) => {
      let msg: { type?: string; data?: string; message?: string };
      try {
        msg = JSON.parse(String(event.data)) as { type?: string; data?: string; message?: string };
      } catch {
        return;
      }
      if (msg.type === "output" && msg.data) {
        term.write(msg.data);
      } else if (msg.type === "status" && msg.message) {
        setStatus(msg.message);
        term.writeln(`\r\n\x1b[90m[${msg.message}]\x1b[0m`);
      } else if (msg.type === "connected") {
        setState("connected");
        setStatus(`Conectado: ${host}:${port}`);
        sendResize();
      } else if (msg.type === "error" && msg.message) {
        setState("error");
        setStatus(msg.message);
        term.writeln(`\r\n\x1b[31m[ERRO] ${msg.message}\x1b[0m`);
      }
    };

    ws.onerror = () => {
      setState("error");
      setStatus("Falha na conexão WebSocket com a API.");
    };

    ws.onclose = () => {
      setState((prev) => (prev === "error" ? "error" : "closed"));
      term.writeln("\r\n\x1b[90m[Sessão encerrada]\x1b[0m");
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    });
  }, [disconnect, enabled, host, port, sendResize, serverId]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => {
      fitRef.current?.fit();
      sendResize();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, sendResize]);

  useEffect(() => () => disconnect(), [disconnect]);

  if (!enabled) return null;

  return (
    <section className="glass-card space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <TerminalSquare className="h-4 w-4 text-accent" />
          <h2 className="text-sm font-semibold">Console SSH</h2>
        </div>
        <div className="flex items-center gap-2">
          {open ? (
            <button
              type="button"
              onClick={() => {
                disconnect();
                setOpen(false);
                setState("idle");
                setStatus(null);
              }}
              className="inline-flex items-center gap-1 rounded-card border border-white/80 bg-white px-2.5 py-1 text-xs text-muted hover:bg-white/90"
            >
              <X className="h-3 w-3" />
              Fechar
            </button>
          ) : null}
          <button
            type="button"
            disabled={open && state === "connecting"}
            onClick={() => void connect()}
            className="inline-flex items-center gap-1 rounded-card bg-accent px-2.5 py-1 text-xs text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {open && state === "connecting" ? <Loader2 className="h-3 w-3 animate-spin" /> : <TerminalSquare className="h-3 w-3" />}
            {open ? "Reconectar" : "Abrir console"}
          </button>
        </div>
      </div>

      <p className="text-xs text-muted">
        Terminal web via xterm.js. A conexão SSH é feita pelo servidor OpsPanel com as credenciais cadastradas; nada é
        exposto no navegador além da sessão interativa.
      </p>

      {open ? (
        <div className="overflow-hidden rounded-lg border border-white/10 bg-[#0d1117]">
          <div ref={containerRef} className="h-[min(420px,55vh)] w-full p-1" />
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-white/30 bg-white/40 px-4 py-8 text-center text-sm text-muted">
          Abra o console para executar comandos no servidor (ex.:{" "}
          <code className="rounded bg-white/80 px-1 font-mono text-xs">ufw allow 22022/tcp</code>).
        </div>
      )}

      {status ? <p className="text-[11px] text-muted">{status}</p> : null}
    </section>
  );
}
