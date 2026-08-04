#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_URL = (process.env.OPSPANEL_API_URL ?? "http://localhost:3001").replace(/\/$/, "");
const API_KEY = process.env.OPSPANEL_API_KEY ?? "";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  if (!API_KEY) {
    throw new Error("OPSPANEL_API_KEY não configurada.");
  }
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

const server = new McpServer({
  name: "opspanel",
  version: "0.1.0",
});

server.tool(
  "list_servers",
  "Lista servidores WordOps da organização",
  {},
  async () => {
    const data = await api<{ servers: unknown[] }>("/servers");
    return { content: [{ type: "text", text: JSON.stringify(data.servers, null, 2) }] };
  },
);

server.tool(
  "list_sites",
  "Lista sites do inventário (opcionalmente filtrados por serverId)",
  { serverId: z.string().uuid().optional() },
  async ({ serverId }) => {
    const qs = serverId ? `?serverId=${encodeURIComponent(serverId)}` : "";
    const data = await api<{ sites: unknown[] }>(`/sites${qs}`);
    return { content: [{ type: "text", text: JSON.stringify(data.sites, null, 2) }] };
  },
);

server.tool(
  "get_dashboard",
  "Resumo da plataforma: servidores, sites, jobs",
  {},
  async () => {
    const data = await api<unknown>("/dashboard/overview");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  "create_site",
  "Cria um site WordOps (retorna jobId para acompanhar)",
  {
    serverId: z.string().uuid(),
    domain: z.string().min(3),
    siteType: z
      .enum(["html", "php", "mysql", "wp", "wpfc", "wpredis", "wpsc", "wprocket", "wpce", "proxy", "alias"])
      .default("wp"),
    sslMode: z.enum(["none", "letsencrypt", "letsencrypt_dns_cf", "letsencrypt_wildcard_cf"]).optional(),
  },
  async (input) => {
    const data = await api<{ jobId: string; status: string }>("/sites", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  "get_job",
  "Consulta status de um job por ID",
  { jobId: z.string().uuid() },
  async ({ jobId }) => {
    const data = await api<unknown>(`/jobs/${jobId}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  "assistant_chat",
  "Envia mensagem ao assistente OpsPanel (pode executar ações)",
  { message: z.string().min(1) },
  async ({ message }) => {
    const data = await api<{ reply: string }>("/assistant/chat", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: message }] }),
    });
    return { content: [{ type: "text", text: data.reply }] };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
