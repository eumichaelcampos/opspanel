import { Readable } from "node:stream";
import type { SFTPWrapper } from "ssh2";
import { UserSecretKind, prisma } from "@opspanel/database";
import { googleOAuthBrokerBaseUrl, googleOAuthBrokerEndpoint, loadEnv } from "@opspanel/config";
import { decryptJson, encryptJson } from "@opspanel/security";
import {
  ensureRemoteDir,
  readRemoteRange,
  remoteFileExists,
  statRemoteSize,
} from "./dest-sftp.js";

type GoogleDriveToken = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  email?: string;
  viaBroker?: boolean;
  brokerUrl?: string;
};

const CHUNK = 8 * 1024 * 1024;

async function loadGoogleApp() {
  const env = loadEnv();
  const setup = await prisma.systemSetupState.findUnique({ where: { id: "default" } });
  let clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim() || setup?.googleDriveClientId?.trim() || "";
  let clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() || "";
  if (
    !clientSecret &&
    setup?.googleDriveClientSecretCipher &&
    setup.googleDriveClientSecretIv &&
    setup.googleDriveClientSecretAuthTag
  ) {
    try {
      const payload = decryptJson<{ clientSecret?: string }>(
        {
          ciphertext: setup.googleDriveClientSecretCipher,
          iv: setup.googleDriveClientSecretIv,
          authTag: setup.googleDriveClientSecretAuthTag,
          keyVersion: 1,
        },
        env.CREDENTIALS_ENCRYPTION_KEY,
      );
      clientSecret = payload.clientSecret?.trim() || "";
    } catch {
      clientSecret = "";
    }
  }
  return { clientId, clientSecret, configured: Boolean(clientId && clientSecret) };
}

async function refreshAccess(clientId: string, clientSecret: string, refreshToken: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!res.ok || !json.access_token) throw new Error("Não foi possível renovar o token do Google Drive.");
  return {
    accessToken: json.access_token,
    expiresAt: Date.now() + Math.max(30, json.expires_in ?? 3600) * 1000,
  };
}

async function refreshViaBroker(brokerUrl: string, refreshToken: string, licenseKey?: string) {
  const res = await fetch(googleOAuthBrokerEndpoint(brokerUrl, "refresh"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken, licenseKey }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    accessToken?: string;
    expiresAt?: number;
    error?: { message?: string };
  };
  if (!res.ok || !json.accessToken || !json.expiresAt) {
    throw new Error(json.error?.message || "Não foi possível renovar o token do Google Drive.");
  }
  return { accessToken: json.accessToken, expiresAt: json.expiresAt };
}

export async function getDriveAccessToken(userId: string): Promise<string | null> {
  const row = await prisma.userSecret.findUnique({
    where: { userId_kind: { userId, kind: UserSecretKind.google_drive } },
  });
  if (!row) return null;
  const env = loadEnv();
  let token: GoogleDriveToken;
  try {
    token = decryptJson<GoogleDriveToken>(
      { ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag, keyVersion: row.keyVersion },
      env.CREDENTIALS_ENCRYPTION_KEY,
    );
  } catch {
    return null;
  }
  if (!token.refreshToken) return null;
  if (token.accessToken && token.expiresAt > Date.now() + 60_000) return token.accessToken;
  try {
    const brokerUrl = token.viaBroker ? token.brokerUrl || googleOAuthBrokerBaseUrl(env) : null;
    const refreshed = brokerUrl
      ? await refreshViaBroker(brokerUrl, token.refreshToken, env.LICENSE_KEY)
      : await (async () => {
          const app = await loadGoogleApp();
          if (!app.configured) throw new Error("OAuth local não configurado.");
          return refreshAccess(app.clientId, app.clientSecret, token.refreshToken);
        })();
    const next = { ...token, ...refreshed };
    const enc = encryptJson(next, env.CREDENTIALS_ENCRYPTION_KEY);
    await prisma.userSecret.update({
      where: { id: row.id },
      data: { ciphertext: enc.ciphertext, iv: enc.iv, authTag: enc.authTag, keyVersion: enc.keyVersion },
    });
    return next.accessToken;
  } catch {
    return null;
  }
}

async function driveJson<T>(accessToken: string, url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text.slice(0, 240) || `Google Drive HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

async function ensureFolder(accessToken: string, name: string, parentId?: string, properties?: Record<string, string>) {
  const q = [
    `name='${name.replace(/'/g, "\\'")}'`,
    "mimeType='application/vnd.google-apps.folder'",
    "trashed=false",
    parentId ? `'${parentId}' in parents` : "'root' in parents",
  ].join(" and ");
  const found = await driveJson<{ files?: { id: string }[] }>(
    accessToken,
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=5`,
  );
  if (found.files?.[0]?.id) return found.files[0].id;
  const created = await driveJson<{ id?: string }>(accessToken, "https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : undefined,
      properties,
    }),
  });
  if (!created.id) throw new Error("Falha ao criar pasta no Google Drive.");
  return created.id;
}

async function uploadRemoteFile(
  accessToken: string,
  sftp: SFTPWrapper,
  remotePath: string,
  name: string,
  parentId: string,
  properties: Record<string, string>,
) {
  const size = await statRemoteSize(sftp, remotePath);
  const startRes = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": "application/gzip",
      "X-Upload-Content-Length": String(size),
    },
    body: JSON.stringify({ name, parents: [parentId], properties }),
  });
  const session = startRes.headers.get("location");
  if (!startRes.ok || !session) {
    const text = await startRes.text().catch(() => "");
    throw new Error(text.slice(0, 240) || "Falha ao iniciar upload no Google Drive.");
  }
  let offset = 0;
  while (offset < size) {
    const end = Math.min(offset + CHUNK, size) - 1;
    const chunk = await readRemoteRange(sftp, remotePath, offset, end);
    const put = await fetch(session, {
      method: "PUT",
      headers: {
        "Content-Length": String(chunk.length),
        "Content-Range": `bytes ${offset}-${end}/${size}`,
      },
      body: new Uint8Array(chunk),
    });
    if (put.status === 200 || put.status === 201) return;
    if (put.status !== 308) {
      const text = await put.text().catch(() => "");
      throw new Error(text.slice(0, 240) || `Upload Drive HTTP ${put.status}`);
    }
    offset = end + 1;
  }
}

export async function uploadBackupToDrive(input: {
  userId: string;
  sftp: SFTPWrapper;
  domain: string;
  backupPath: string;
  filesArchive?: string;
  databaseArchive?: string;
}): Promise<{ folderId: string }> {
  const access = await getDriveAccessToken(input.userId);
  if (!access) throw new Error("Google Drive não está conectado.");
  const timestamp = input.backupPath.split("/").filter(Boolean).pop() || String(Date.now());
  const rootId = await ensureFolder(access, "OpsPanel");
  const domainId = await ensureFolder(access, input.domain.toLowerCase(), rootId);
  const folderId = await ensureFolder(access, timestamp, domainId, {
    opspanel: "backup",
    opspanelDomain: input.domain.toLowerCase(),
    opspanelTimestamp: timestamp,
    opspanelKind: "folder",
  });
  if (input.filesArchive && (await remoteFileExists(input.sftp, input.filesArchive))) {
    await uploadRemoteFile(access, input.sftp, input.filesArchive, "files.tar.gz", folderId, {
      opspanel: "backup",
      opspanelDomain: input.domain.toLowerCase(),
      opspanelTimestamp: timestamp,
      opspanelKind: "files",
    });
  }
  if (input.databaseArchive && (await remoteFileExists(input.sftp, input.databaseArchive))) {
    await uploadRemoteFile(access, input.sftp, input.databaseArchive, "database.sql.gz", folderId, {
      opspanel: "backup",
      opspanelDomain: input.domain.toLowerCase(),
      opspanelTimestamp: timestamp,
      opspanelKind: "database",
    });
  }
  return { folderId };
}

export async function downloadDriveFolderToRemote(input: {
  userId: string;
  sftp: SFTPWrapper;
  domain: string;
  folderId: string;
}): Promise<string> {
  const access = await getDriveAccessToken(input.userId);
  if (!access) throw new Error("Google Drive não está conectado.");
  const listed = await driveJson<{ files?: { id: string; name: string }[] }>(
    access,
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${input.folderId}' in parents and trashed=false`)}&fields=files(id,name)&pageSize=20`,
  );
  const ts = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);
  const dest = `/var/backups/opspanel/${input.domain.toLowerCase()}/${ts}`;
  await ensureRemoteDir(input.sftp, dest);

  for (const file of listed.files ?? []) {
    if (file.name !== "files.tar.gz" && file.name !== "database.sql.gz") continue;
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
      headers: { Authorization: `Bearer ${access}` },
    });
    if (!res.ok || !res.body) throw new Error(`Falha ao baixar ${file.name} do Google Drive.`);
    const remotePath = `${dest}/${file.name}`;
    await new Promise<void>((resolve, reject) => {
      const ws = input.sftp.createWriteStream(remotePath);
      ws.on("close", () => resolve());
      ws.on("error", reject);
      Readable.fromWeb(res.body as never)
        .on("error", reject)
        .pipe(ws);
    });
  }
  return dest;
}
