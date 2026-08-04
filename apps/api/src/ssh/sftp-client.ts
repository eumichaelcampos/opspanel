import { Client, SFTPWrapper } from "ssh2";
import { SshTarget } from "./ssh-shell.js";

function connectOptions(target: SshTarget) {
  return {
    host: target.host,
    port: target.port,
    username: target.username,
    privateKey: target.privateKey,
    password: target.password,
    readyTimeout: 15000,
  };
}

export async function withSftp<T>(target: SshTarget, fn: (sftp: SFTPWrapper) => Promise<T>): Promise<T> {
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

export type SftpEntry = {
  filename: string;
  longname: string;
  attrs: {
    size: number;
    mtime: number;
    mode: number;
    isDirectory(): boolean;
    isFile(): boolean;
  };
};

export function listDirectory(sftp: SFTPWrapper, remotePath: string): Promise<SftpEntry[]> {
  return new Promise((resolve, reject) => {
    sftp.readdir(remotePath, (err, list) => {
      if (err) reject(err);
      else resolve(list as SftpEntry[]);
    });
  });
}

export function readFileBuffer(sftp: SFTPWrapper, remotePath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = sftp.createReadStream(remotePath);
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

export function writeFileBuffer(sftp: SFTPWrapper, remotePath: string, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = sftp.createWriteStream(remotePath);
    stream.on("close", () => resolve());
    stream.on("error", reject);
    stream.end(data);
  });
}

export function mkdirRemote(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.mkdir(remotePath, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export function removeRemote(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.unlink(remotePath, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export function removeDirectory(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.rmdir(remotePath, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export function renameRemote(sftp: SFTPWrapper, from: string, to: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.rename(from, to, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export function statRemote(sftp: SFTPWrapper, remotePath: string): Promise<SftpEntry["attrs"]> {
  return new Promise((resolve, reject) => {
    sftp.stat(remotePath, (err, stats) => {
      if (err) reject(err);
      else resolve(stats as SftpEntry["attrs"]);
    });
  });
}
