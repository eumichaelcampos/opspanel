import { Client, SFTPWrapper } from "ssh2";

export interface RemoteFtpCredentials {
  protocol: "ftp" | "ftps" | "sftp";
  host: string;
  port?: number;
  username: string;
  password: string;
}

export interface RemoteFileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
}

function defaultPort(protocol: RemoteFtpCredentials["protocol"]): number {
  if (protocol === "sftp") return 22;
  return 21;
}

function normalizeRemotePath(base: string, name: string): string {
  const root = base.endsWith("/") ? base.slice(0, -1) : base;
  if (!root || root === "/") return `/${name}`;
  return `${root}/${name}`;
}

function connectSftpClient(creds: RemoteFtpCredentials): Promise<{ client: Client; sftp: SFTPWrapper }> {
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
        readyTimeout: 20000,
      });
  });
}

function sftpListDir(sftp: SFTPWrapper, remotePath: string): Promise<RemoteFileEntry[]> {
  return new Promise((resolve, reject) => {
    sftp.readdir(remotePath, (err, list) => {
      if (err) return reject(err);
      const entries: RemoteFileEntry[] = [];
      for (const item of list) {
        if (item.filename === "." || item.filename === "..") continue;
        entries.push({
          name: item.filename,
          path: normalizeRemotePath(remotePath, item.filename),
          isDirectory: item.attrs.isDirectory(),
          size: item.attrs.size ?? 0,
        });
      }
      resolve(entries);
    });
  });
}

function sftpReadFile(sftp: SFTPWrapper, remotePath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = sftp.createReadStream(remotePath);
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

async function listSftpRecursive(
  sftp: SFTPWrapper,
  remotePath: string,
  acc: RemoteFileEntry[] = [],
): Promise<RemoteFileEntry[]> {
  const entries = await sftpListDir(sftp, remotePath);
  for (const entry of entries) {
    if (entry.isDirectory) {
      await listSftpRecursive(sftp, entry.path, acc);
    } else {
      acc.push(entry);
    }
  }
  return acc;
}

async function withSftpSource<T>(creds: RemoteFtpCredentials, fn: (sftp: SFTPWrapper) => Promise<T>): Promise<T> {
  const { client, sftp } = await connectSftpClient(creds);
  try {
    return await fn(sftp);
  } finally {
    client.end();
  }
}

async function withBasicFtp<T>(
  creds: RemoteFtpCredentials,
  fn: (client: import("basic-ftp").Client) => Promise<T>,
): Promise<T> {
  const { Client: FtpClient } = await import("basic-ftp");
  const client = new FtpClient(120_000);
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

export async function listRemoteFiles(creds: RemoteFtpCredentials, remotePath: string): Promise<RemoteFileEntry[]> {
  const path = remotePath.trim() || "/";
  if (creds.protocol === "sftp") {
    return withSftpSource(creds, (sftp) => listSftpRecursive(sftp, path));
  }
  return withBasicFtp(creds, (client) => listFtpRecursive(client, path));
}

function isFtpDirectory(item: { type: number; name: string }): boolean {
  // basic-ftp FileType.Directory = 2; alguns servidores misturam LIST/MLSD
  return item.type === 2;
}

async function listFtpRecursive(
  client: import("basic-ftp").Client,
  remotePath: string,
  acc: RemoteFileEntry[] = [],
): Promise<RemoteFileEntry[]> {
  const entries = await client.list(remotePath === "/" ? "/" : remotePath);
  for (const item of entries) {
    if (item.name === "." || item.name === "..") continue;
    const path = normalizeRemotePath(remotePath, item.name);
    if (isFtpDirectory(item)) {
      await listFtpRecursive(client, path, acc);
    } else {
      acc.push({ name: item.name, path, isDirectory: false, size: item.size });
    }
  }
  return acc;
}

async function readFtpFile(client: import("basic-ftp").Client, remotePath: string): Promise<Buffer> {
  const { Writable } = await import("node:stream");
  const chunks: Buffer[] = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      cb();
    },
  });
  await client.downloadTo(sink, remotePath);
  return Buffer.concat(chunks);
}

export async function readRemoteFile(creds: RemoteFtpCredentials, remotePath: string): Promise<Buffer> {
  if (creds.protocol === "sftp") {
    return withSftpSource(creds, (sftp) => sftpReadFile(sftp, remotePath));
  }
  return withBasicFtp(creds, (client) => readFtpFile(client, remotePath));
}

export async function listRemoteDirectory(
  creds: RemoteFtpCredentials,
  remotePath: string,
): Promise<RemoteFileEntry[]> {
  const path = remotePath.trim() || "/";
  if (creds.protocol === "sftp") {
    return withSftpSource(creds, (sftp) => sftpListDir(sftp, path));
  }
  return withBasicFtp(creds, async (client) => {
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

export type DetectedSiteKind = "wordpress" | "php" | "html";

/** Contas FTP HostGator (addon) já abrem na pasta do site; caminhos /homeN/... falham. */
export async function resolveUsableSourcePath(
  creds: RemoteFtpCredentials,
  requestedPath: string,
): Promise<{ path: string; adjusted: boolean; note?: string }> {
  const requested = (requestedPath || "/").trim() || "/";
  try {
    const entries = await listRemoteDirectory(creds, requested);
    if (entries.length > 0) return { path: requested, adjusted: false };
  } catch {
    /* try fallbacks */
  }

  const looksLikeAbsoluteHome = /^\/home\d*\//i.test(requested) || /^\/home\//i.test(requested);
  if (requested !== "/" || looksLikeAbsoluteHome) {
    try {
      const rootEntries = await listRemoteDirectory(creds, "/");
      if (rootEntries.length > 0) {
        return {
          path: "/",
          adjusted: true,
          note: looksLikeAbsoluteHome
            ? "A conta FTP já inicia na pasta do site. O caminho absoluto /home... não existe no chroot; usando /."
            : "Pasta informada vazia ou inacessível; usando /.",
        };
      }
    } catch {
      /* keep original error below */
    }
  }

  // Re-throw by attempting original again
  await listRemoteDirectory(creds, requested);
  return { path: requested, adjusted: false };
}

export async function detectRemoteSiteKind(
  creds: RemoteFtpCredentials,
  remotePath: string,
): Promise<{ kind: DetectedSiteKind; wpConfigPath?: string; contentRoot: string; pathNote?: string }> {
  const resolved = await resolveUsableSourcePath(creds, remotePath);
  const root = resolved.path;
  const entries = await listRemoteDirectory(creds, root);
  const names = new Set(entries.map((e) => e.name.toLowerCase()));

  if (names.has("wp-config.php")) {
    return {
      kind: "wordpress",
      wpConfigPath: normalizeRemotePath(root, "wp-config.php"),
      contentRoot: root,
      pathNote: resolved.note,
    };
  }

  const htdocs = entries.find((e) => e.isDirectory && e.name.toLowerCase() === "htdocs");
  if (htdocs) {
    const inner = await listRemoteDirectory(creds, htdocs.path);
    if (inner.some((e) => e.name.toLowerCase() === "wp-config.php")) {
      return {
        kind: "wordpress",
        wpConfigPath: normalizeRemotePath(htdocs.path, "wp-config.php"),
        contentRoot: htdocs.path,
        pathNote: resolved.note,
      };
    }
  }

  const publicHtml = entries.find((e) => e.isDirectory && ["public_html", "www", "web"].includes(e.name.toLowerCase()));
  if (publicHtml) {
    const inner = await listRemoteDirectory(creds, publicHtml.path);
    if (inner.some((e) => e.name.toLowerCase() === "wp-config.php")) {
      return {
        kind: "wordpress",
        wpConfigPath: normalizeRemotePath(publicHtml.path, "wp-config.php"),
        contentRoot: publicHtml.path,
        pathNote: resolved.note,
      };
    }
    if (inner.some((e) => e.name.toLowerCase().endsWith(".php"))) {
      return { kind: "php", contentRoot: publicHtml.path, pathNote: resolved.note };
    }
    return { kind: "html", contentRoot: publicHtml.path, pathNote: resolved.note };
  }

  if ([...names].some((n) => n.endsWith(".php"))) return { kind: "php", contentRoot: root, pathNote: resolved.note };
  return { kind: "html", contentRoot: root, pathNote: resolved.note };
}

export async function downloadRemoteFileStream(
  creds: RemoteFtpCredentials,
  remotePath: string,
): Promise<Buffer> {
  return readRemoteFile(creds, remotePath);
}
