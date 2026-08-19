import { Client, type SFTPWrapper } from "ssh2";

export type SourceFtpProtocol = "ftp" | "ftps" | "sftp";

export interface SourceFtpCredentials {
  protocol: SourceFtpProtocol;
  host: string;
  port?: number;
  username: string;
  password: string;
}

export interface SourceFtpEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
}

function defaultPort(protocol: SourceFtpProtocol): number {
  return protocol === "sftp" ? 22 : 21;
}

function normalizeRemotePath(base: string, name: string): string {
  const root = base.endsWith("/") ? base.slice(0, -1) : base;
  if (!root || root === "/") return `/${name}`;
  return `${root}/${name}`;
}

function friendlyFtpError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/ENOTFOUND/i.test(msg)) {
    return `Host não encontrado (DNS). Verifique o endereço FTP: ${msg}`;
  }
  if (/ECONNREFUSED/i.test(msg)) {
    return `Conexão recusada. Verifique host/porta/protocolo: ${msg}`;
  }
  if (/ETIMEDOUT|timed out/i.test(msg)) {
    return `Tempo esgotado ao conectar. Verifique firewall e porta: ${msg}`;
  }
  if (/530|Login incorrect|authentication/i.test(msg)) {
    return `Usuário ou senha inválidos: ${msg}`;
  }
  if (/550|Can't check for file existence|No such file/i.test(msg)) {
    return `Pasta não encontrada no FTP. Em contas HostGator/addon domain use "/" (a conta já abre na pasta do site). Não use /home.../dominio. Detalhe: ${msg}`;
  }
  return msg;
}

function connectSftp(creds: SourceFtpCredentials): Promise<{ client: Client; sftp: SFTPWrapper }> {
  const client = new Client();
  return new Promise((resolve, reject) => {
    client
      .on("ready", () => {
        client.sftp((err, sftp) => {
          if (err) {
            client.end();
            reject(err);
            return;
          }
          resolve({ client, sftp });
        });
      })
      .on("error", reject)
      .connect({
        host: creds.host,
        port: creds.port ?? defaultPort("sftp"),
        username: creds.username,
        password: creds.password,
        readyTimeout: 20_000,
      });
  });
}

async function withSftp<T>(creds: SourceFtpCredentials, fn: (sftp: SFTPWrapper) => Promise<T>): Promise<T> {
  const { client, sftp } = await connectSftp(creds);
  try {
    return await fn(sftp);
  } finally {
    client.end();
  }
}

async function withFtp<T>(
  creds: SourceFtpCredentials,
  fn: (client: import("basic-ftp").Client) => Promise<T>,
): Promise<T> {
  const { Client: FtpClient } = await import("basic-ftp");
  const client = new FtpClient(30_000);
  client.ftp.verbose = false;
  try {
    await client.access({
      host: creds.host,
      port: creds.port ?? defaultPort(creds.protocol),
      user: creds.username,
      password: creds.password,
      secure: creds.protocol === "ftps",
    });
    return await fn(client);
  } finally {
    client.close();
  }
}

function listSftpDir(sftp: SFTPWrapper, remotePath: string): Promise<SourceFtpEntry[]> {
  return new Promise((resolve, reject) => {
    sftp.readdir(remotePath, (err, list) => {
      if (err) return reject(err);
      resolve(
        list
          .filter((item) => item.filename !== "." && item.filename !== "..")
          .map((item) => ({
            name: item.filename,
            path: normalizeRemotePath(remotePath, item.filename),
            isDirectory: item.attrs.isDirectory(),
            size: item.attrs.size ?? 0,
          })),
      );
    });
  });
}

export async function listSourceDirectory(
  creds: SourceFtpCredentials,
  remotePath: string,
): Promise<SourceFtpEntry[]> {
  const path = remotePath.trim() || "/";
  if (creds.protocol === "sftp") {
    return withSftp(creds, (sftp) => listSftpDir(sftp, path));
  }
  return withFtp(creds, async (client) => {
    const entries = await client.list(path === "/" ? "/" : path);
    return entries
      .filter((e) => e.name !== "." && e.name !== "..")
      .map((item) => ({
        name: item.name,
        path: normalizeRemotePath(path, item.name),
        isDirectory: item.type === 2,
        size: item.size,
      }));
  });
}

async function resolveBrowsePath(
  creds: SourceFtpCredentials,
  remotePath: string,
): Promise<{ path: string; note?: string }> {
  const requested = remotePath.trim() || "/";
  try {
    const entries = await listSourceDirectory(creds, requested);
    if (entries.length > 0) return { path: requested };
    if (requested !== "/") {
      const root = await listSourceDirectory(creds, "/");
      if (root.length > 0) {
        return {
          path: "/",
          note: "A pasta informada estava vazia. Abrindo / (conta FTP addon costuma já iniciar no site).",
        };
      }
    }
    return { path: requested };
  } catch (err) {
    const looksLikeHome = /^\/home\d*\//i.test(requested);
    if (requested !== "/" || looksLikeHome) {
      try {
        const root = await listSourceDirectory(creds, "/");
        if (root.length > 0) {
          return {
            path: "/",
            note: looksLikeHome
              ? "Caminho /home... não existe no chroot FTP. Abrindo / (pasta do site)."
              : "Pasta inacessível. Abrindo /.",
          };
        }
      } catch {
        /* fallthrough */
      }
    }
    throw err;
  }
}

export async function testSourceConnection(
  creds: SourceFtpCredentials,
  remotePath: string,
): Promise<{
  ok: true;
  cwd: string;
  entryCount: number;
  directories: string[];
  files: string[];
  hints: string[];
  note?: string;
}> {
  try {
    const resolved = await resolveBrowsePath(creds, remotePath);
    const entries = await listSourceDirectory(creds, resolved.path);
    const directories = entries.filter((e) => e.isDirectory).map((e) => e.name);
    const files = entries.filter((e) => !e.isDirectory).map((e) => e.name);
    const lower = new Set([...directories, ...files].map((n) => n.toLowerCase()));
    const hints: string[] = [];
    if (resolved.note) hints.push(resolved.note);
    if (lower.has("wp-config.php") || lower.has("wp-load.php")) {
      hints.push("WordPress detectado nesta pasta. Use esta pasta (/) na migração.");
    }
    for (const candidate of ["public_html", "www", "htdocs", "web", "wp-content"]) {
      if (lower.has(candidate)) {
        hints.push(`Pasta "${candidate}" encontrada.`);
      }
    }
    if (entries.length === 0) {
      hints.push("Pasta vazia. Em HostGator addon domain o caminho correto costuma ser apenas /.");
    }
    return {
      ok: true,
      cwd: resolved.path,
      entryCount: entries.length,
      directories: directories.slice(0, 80),
      files: files.slice(0, 80),
      hints,
      note: resolved.note,
    };
  } catch (err) {
    throw new Error(friendlyFtpError(err));
  }
}

export async function browseSourceDirectory(
  creds: SourceFtpCredentials,
  remotePath: string,
): Promise<{ path: string; entries: SourceFtpEntry[]; note?: string }> {
  try {
    const resolved = await resolveBrowsePath(creds, remotePath);
    const entries = await listSourceDirectory(creds, resolved.path);
    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return { path: resolved.path, entries, note: resolved.note };
  } catch (err) {
    throw new Error(friendlyFtpError(err));
  }
}
