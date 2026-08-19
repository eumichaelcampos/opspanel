export type DriveBackupFile = {
  folderId: string;
  timestamp: string;
  name: string;
  hasFiles: boolean;
  hasDatabase: boolean;
  filesId?: string;
  databaseId?: string;
  filesSizeBytes: number;
};

type DriveFile = {
  id: string;
  name: string;
  mimeType?: string;
  size?: string;
  properties?: Record<string, string>;
};

export async function driveGetJson<T>(accessToken: string, url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text.slice(0, 240) || `Google Drive HTTP ${res.status}`);
  }
  if (res.status === 204) return {} as T;
  return (await res.json()) as T;
}

export async function driveEnsureFolder(
  accessToken: string,
  name: string,
  parentId?: string,
  properties?: Record<string, string>,
): Promise<string> {
  const qParts = [
    `name='${name.replace(/'/g, "\\'")}'`,
    "mimeType='application/vnd.google-apps.folder'",
    "trashed=false",
  ];
  if (parentId) qParts.push(`'${parentId}' in parents`);
  else qParts.push("'root' in parents");
  const found = await driveGetJson<{ files?: DriveFile[] }>(
    accessToken,
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(qParts.join(" and "))}&fields=files(id,name)&pageSize=5`,
  );
  if (found.files?.[0]?.id) return found.files[0].id;

  const created = await driveGetJson<DriveFile>(accessToken, "https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : undefined,
      properties,
    }),
  });
  if (!created.id) throw new Error("Não foi possível criar pasta no Google Drive.");
  return created.id;
}

export async function driveListSiteBackups(accessToken: string, domain: string): Promise<DriveBackupFile[]> {
  const q = [
    "trashed=false",
    "properties has { key='opspanel' and value='backup' }",
    `properties has { key='opspanelDomain' and value='${domain.replace(/'/g, "\\'")}' }`,
  ].join(" and ");
  const listed = await driveGetJson<{ files?: DriveFile[] }>(
    accessToken,
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,size,properties)&pageSize=100`,
  );
  const folders = new Map<string, DriveBackupFile>();
  for (const file of listed.files ?? []) {
    const ts = file.properties?.opspanelTimestamp;
    if (!ts) continue;
    const kind = file.properties?.opspanelKind;
    if (file.mimeType === "application/vnd.google-apps.folder" || kind === "folder") {
      const current = folders.get(ts) ?? {
        folderId: file.id,
        timestamp: ts,
        name: file.name,
        hasFiles: false,
        hasDatabase: false,
        filesSizeBytes: 0,
      };
      current.folderId = file.id;
      current.name = file.name;
      folders.set(ts, current);
      continue;
    }
    const current = folders.get(ts) ?? {
      folderId: file.id,
      timestamp: ts,
      name: file.name,
      hasFiles: false,
      hasDatabase: false,
      filesSizeBytes: 0,
    };
    if (kind === "files" || file.name === "files.tar.gz") {
      current.hasFiles = true;
      current.filesId = file.id;
      current.filesSizeBytes += Number(file.size ?? 0) || 0;
    }
    if (kind === "database" || file.name === "database.sql.gz") {
      current.hasDatabase = true;
      current.databaseId = file.id;
      if (!current.hasFiles) current.filesSizeBytes += Number(file.size ?? 0) || 0;
    }
    folders.set(ts, current);
  }
  return [...folders.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export async function driveStartResumableUpload(input: {
  accessToken: string;
  name: string;
  parentId: string;
  size: number;
  mimeType: string;
  properties?: Record<string, string>;
}): Promise<string> {
  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": input.mimeType,
      "X-Upload-Content-Length": String(input.size),
    },
    body: JSON.stringify({
      name: input.name,
      parents: [input.parentId],
      properties: input.properties,
    }),
  });
  const location = res.headers.get("location");
  if (!res.ok || !location) {
    const text = await res.text().catch(() => "");
    throw new Error(text.slice(0, 240) || "Falha ao iniciar upload no Google Drive.");
  }
  return location;
}

export async function drivePutChunk(sessionUrl: string, chunk: Buffer, start: number, total: number): Promise<"ok" | "continue"> {
  const end = start + chunk.length - 1;
  const res = await fetch(sessionUrl, {
    method: "PUT",
    headers: {
      "Content-Length": String(chunk.length),
      "Content-Range": `bytes ${start}-${end}/${total}`,
    },
    body: new Uint8Array(chunk),
  });
  if (res.status === 200 || res.status === 201) return "ok";
  if (res.status === 308) return "continue";
  const text = await res.text().catch(() => "");
  throw new Error(text.slice(0, 240) || `Upload Drive HTTP ${res.status}`);
}

export async function driveDownloadFile(accessToken: string, fileId: string): Promise<Buffer> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text.slice(0, 240) || `Download Drive HTTP ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
