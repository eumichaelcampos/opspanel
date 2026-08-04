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
