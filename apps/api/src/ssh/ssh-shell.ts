import { Client } from "ssh2";

export interface SshTarget {
  host: string;
  port: number;
  username: string;
  privateKey?: string;
  password?: string;
}

export interface InteractiveShell {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  close(): void;
}

export function openInteractiveShell(
  target: SshTarget,
  opts: {
    cols: number;
    rows: number;
    onData: (data: string) => void;
    onClose: () => void;
    onError: (err: Error) => void;
  },
): Promise<InteractiveShell> {
  const client = new Client();
  return new Promise((resolve, reject) => {
    client.on("ready", () => {
      client.shell({ term: "xterm-256color", cols: opts.cols, rows: opts.rows }, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }
        stream.on("data", (data: Buffer) => opts.onData(data.toString("utf8")));
        stream.on("close", () => {
          client.end();
          opts.onClose();
        });
        stream.stderr.on("data", (data: Buffer) => opts.onData(data.toString("utf8")));
        resolve({
          write(data: string) {
            stream.write(data);
          },
          resize(cols: number, rows: number) {
            stream.setWindow(rows, cols, 0, 0);
          },
          close() {
            client.end();
          },
        });
      });
    });
    client.on("error", (err) => {
      opts.onError(err);
      reject(err);
    });
    client.connect({
      host: target.host,
      port: target.port,
      username: target.username,
      privateKey: target.privateKey,
      password: target.password,
      readyTimeout: 15000,
    });
  });
}

export function execSshCommand(
  target: SshTarget,
  command: string,
  options?: { timeoutMs?: number },
): Promise<{ stdout: string; stderr: string; code: number }> {
  const client = new Client();
  const timeoutMs = options?.timeoutMs ?? 60_000;

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      client.end();
      reject(new Error(`SSH command timeout after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    client.on("ready", () => {
      client.exec(command, {}, (err, stream) => {
        if (err) {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            client.end();
            reject(err);
          }
          return;
        }

        let stdout = "";
        let stderr = "";
        stream.on("close", (code: number) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          client.end();
          resolve({ stdout, stderr, code: code ?? 0 });
        });
        stream.on("data", (data: Buffer) => {
          stdout += data.toString();
        });
        stream.stderr?.on("data", (data: Buffer) => {
          stderr += data.toString();
        });
      });
    });

    client.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    client.connect({
      host: target.host,
      port: target.port,
      username: target.username,
      privateKey: target.privateKey,
      password: target.password,
      readyTimeout: 15_000,
    });
  });
}

export function formatSshError(err: unknown, target: SshTarget): string {
  const detail = err instanceof Error ? err.message : String(err);
  if (/timed out|timeout|ETIMEDOUT/i.test(detail)) {
    return (
      `SSH indisponível em ${target.host}:${target.port} (timeout). ` +
      `Verifique se o firewall (UFW) liberou a porta ${target.port} e se o serviço SSH está ativo.`
    );
  }
  if (/ECONNREFUSED/i.test(detail)) {
    return `Conexão recusada em ${target.host}:${target.port}. SSH pode estar parado ou a porta está errada.`;
  }
  if (/authentication|auth fail/i.test(detail)) {
    return `Autenticação SSH falhou para ${target.username}@${target.host}:${target.port}. Verifique usuário e senha.`;
  }
  return `SSH ${target.host}:${target.port}: ${detail}`;
}
