import { Client, SFTPWrapper } from "ssh2";
import type { SshTarget } from "./ssh-executor.js";

function connectOptions(target: SshTarget) {
  return {
    host: target.host,
    port: target.port,
    username: target.username,
    privateKey: target.privateKey,
    password: target.password,
    readyTimeout: 20000,
  };
}

export async function withDestSftp<T>(target: SshTarget, fn: (sftp: SFTPWrapper) => Promise<T>): Promise<T> {
  const client = new Client();
  return new Promise((resolve, reject) => {
    client.on("ready", () => {
      client.sftp((err, sftp) => {
        if (err) {
          client.end();
          reject(err);
          return;
        }
        fn(sftp)
          .then((result) => {
            client.end();
            resolve(result);
          })
          .catch((error) => {
            client.end();
            reject(error);
          });
      });
    });
    client.on("error", reject);
    client.connect(connectOptions(target));
  });
}

export function mkdirRemote(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.mkdir(remotePath, (err) => {
      if (err && (err as NodeJS.ErrnoException).code !== "EEXIST") reject(err);
      else resolve();
    });
  });
}

export async function ensureRemoteDir(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  const parts = remotePath.split("/").filter(Boolean);
  let current = remotePath.startsWith("/") ? "" : "";
  for (const part of parts) {
    current += `/${part}`;
    await mkdirRemote(sftp, current);
  }
}

export function writeRemoteBuffer(sftp: SFTPWrapper, remotePath: string, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = sftp.createWriteStream(remotePath);
    stream.on("close", () => resolve());
    stream.on("error", reject);
    stream.end(data);
  });
}

export function chmodRemote(sftp: SFTPWrapper, remotePath: string, mode: number): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.chmod(remotePath, mode, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export function statRemoteSize(sftp: SFTPWrapper, remotePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    sftp.stat(remotePath, (err, stats) => {
      if (err) reject(err);
      else resolve(stats.size);
    });
  });
}

export function readRemoteRange(
  sftp: SFTPWrapper,
  remotePath: string,
  start: number,
  endInclusive: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = sftp.createReadStream(remotePath, { start, end: endInclusive });
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

export function remoteFileExists(sftp: SFTPWrapper, remotePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    sftp.stat(remotePath, (err) => resolve(!err));
  });
}
