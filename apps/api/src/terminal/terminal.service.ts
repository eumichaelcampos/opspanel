import { Injectable } from "@nestjs/common";
import { OrgRole } from "@opspanel/database";
import type { FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { SESSION_COOKIE } from "../auth/auth.guard";
import { ServersService } from "../servers/servers.service";
import { formatSshError, openInteractiveShell, type InteractiveShell } from "../ssh/ssh-shell";

type WsMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number };

function parseCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) {
      return decodeURIComponent(trimmed.slice(name.length + 1));
    }
  }
  return undefined;
}

function sendJson(socket: WebSocket, payload: Record<string, unknown>) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

@Injectable()
export class TerminalService {
  constructor(
    private readonly auth: AuthService,
    private readonly servers: ServersService,
    private readonly audit: AuditService,
  ) {}

  handleConnection(socket: WebSocket, req: FastifyRequest) {
    const pendingMessages: Buffer[] = [];
    let shell: InteractiveShell | null = null;
    let messageHandler: ((raw: Buffer) => void) | null = null;

    socket.on("message", (raw) => {
      const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw));
      if (messageHandler) messageHandler(buf);
      else pendingMessages.push(buf);
    });

    socket.on("close", () => {
      shell?.close();
    });

    void this.bootstrap(socket, req, (handler, sessionShell) => {
      shell = sessionShell;
      messageHandler = handler;
      for (const msg of pendingMessages) handler(msg);
    });
  }

  private async bootstrap(
    socket: WebSocket,
    req: FastifyRequest,
    onReady: (handler: (raw: Buffer) => void, shell: InteractiveShell) => void,
  ) {
    const serverId = (req.params as { serverId?: string }).serverId;
    if (!serverId) {
      sendJson(socket, { type: "error", message: "Servidor não informado." });
      socket.close();
      return;
    }

    const token = parseCookie(req.headers.cookie, SESSION_COOKIE);
    if (!token) {
      sendJson(socket, { type: "error", message: "Sessão inválida ou expirada." });
      socket.close();
      return;
    }

    const user = await this.auth.validateSessionToken(token);
    if (!user) {
      sendJson(socket, { type: "error", message: "Sessão inválida ou expirada." });
      socket.close();
      return;
    }

    const allowedRoles: OrgRole[] = [OrgRole.owner, OrgRole.admin, OrgRole.operator];
    if (!allowedRoles.includes(user.role)) {
      sendJson(socket, { type: "error", message: "Permissão insuficiente para abrir o console." });
      socket.close();
      return;
    }

    let target;
    try {
      target = await this.servers.getSshTarget(user, serverId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Servidor não encontrado.";
      sendJson(socket, { type: "error", message });
      socket.close();
      return;
    }

    sendJson(socket, {
      type: "status",
      message: `Conectando a ${target.username}@${target.host}:${target.port}…`,
    });

    let sessionShell: InteractiveShell;
    try {
      sessionShell = await openInteractiveShell(target, {
        cols: 120,
        rows: 32,
        onData: (data) => sendJson(socket, { type: "output", data }),
        onClose: () => {
          sendJson(socket, { type: "status", message: "Sessão SSH encerrada." });
          socket.close();
        },
        onError: (err) => sendJson(socket, { type: "error", message: formatSshError(err, target) }),
      });
    } catch (err) {
      sendJson(socket, { type: "error", message: formatSshError(err, target) });
      socket.close();
      return;
    }

    await this.audit.log({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "server.terminal.open",
      targetType: "server",
      targetId: serverId,
      result: "success",
      ipAddress: req.ip,
      metadata: { host: target.host, port: target.port },
    });

    sendJson(socket, {
      type: "connected",
      host: target.host,
      port: target.port,
      username: target.username,
    });

    const handler = (raw: Buffer) => {
      let parsed: WsMessage;
      try {
        parsed = JSON.parse(raw.toString("utf8")) as WsMessage;
      } catch {
        return;
      }
      if (parsed.type === "input" && typeof parsed.data === "string") {
        sessionShell.write(parsed.data);
      } else if (parsed.type === "resize" && parsed.cols > 0 && parsed.rows > 0) {
        sessionShell.resize(parsed.cols, parsed.rows);
      }
    };

    onReady(handler, sessionShell);

    socket.on("close", () => {
      void this.audit.log({
        organizationId: user.organizationId,
        actorUserId: user.id,
        action: "server.terminal.close",
        targetType: "server",
        targetId: serverId,
        result: "success",
        ipAddress: req.ip,
      });
    });
  }
}
