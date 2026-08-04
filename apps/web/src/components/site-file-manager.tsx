"use client";

import { useCallback, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  Download,
  Edit3,
  File,
  FileCode,
  FileImage,
  FileText,
  Folder,
  FolderPlus,
  Home,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { apiFetch, apiUrl } from "@/lib/api";

type FileEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: string;
  permissions: string;
};

type FileListResponse = {
  siteRoot: string;
  path: string;
  entries: FileEntry[];
};

function fileIcon(name: string, isDirectory: boolean) {
  if (isDirectory) return Folder;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"].includes(ext)) return FileImage;
  if (["php", "js", "ts", "tsx", "jsx", "css", "scss", "html", "htm", "json", "xml", "yml", "yaml"].includes(ext))
    return FileCode;
  if (["txt", "md", "log", "htaccess", "env"].includes(ext) || name === ".htaccess") return FileText;
  return File;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function isEditable(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return ["php", "css", "scss", "js", "ts", "html", "htm", "txt", "md", "json", "xml", "yml", "yaml", "env", "htaccess"].includes(ext) || name === ".htaccess";
}

export function SiteFileManager({ siteId, domain, webroot }: { siteId: string; domain: string; webroot?: string }) {
  const qc = useQueryClient();
  const uploadRef = useRef<HTMLInputElement>(null);
  const [currentPath, setCurrentPath] = useState("");
  const [editor, setEditor] = useState<{ path: string; content: string; name: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const listQuery = useQuery({
    queryKey: ["site-files", siteId, currentPath],
    queryFn: () => apiFetch<FileListResponse>(`/sites/${siteId}/files?path=${encodeURIComponent(currentPath)}`),
  });

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["site-files", siteId] });
  }, [qc, siteId]);

  const openEditor = useMutation({
    mutationFn: (path: string) => apiFetch<{ content: string; encoding: string }>(`/sites/${siteId}/files/content?path=${encodeURIComponent(path)}`),
    onSuccess: (data, path) => {
      if (data.encoding === "base64") {
        setMsg("Arquivo binário; use download.");
        return;
      }
      setEditor({ path, content: data.content, name: path.split("/").pop() ?? path });
    },
    onError: (err: Error) => setMsg(err.message),
  });

  const saveEditor = useMutation({
    mutationFn: () =>
      apiFetch(`/sites/${siteId}/files/content`, {
        method: "PATCH",
        body: JSON.stringify({ path: editor!.path, content: editor!.content }),
      }),
    onSuccess: () => {
      setMsg("Arquivo salvo.");
      setEditor(null);
      refresh();
    },
    onError: (err: Error) => setMsg(err.message),
  });

  const mkdir = useMutation({
    mutationFn: (name: string) =>
      apiFetch(`/sites/${siteId}/files/mkdir`, {
        method: "POST",
        body: JSON.stringify({ path: currentPath ? `${currentPath}/${name}` : name }),
      }),
    onSuccess: () => {
      setMsg("Pasta criada.");
      refresh();
    },
    onError: (err: Error) => setMsg(err.message),
  });

  const remove = useMutation({
    mutationFn: (path: string) =>
      apiFetch(`/sites/${siteId}/files?path=${encodeURIComponent(path)}`, { method: "DELETE" }),
    onSuccess: () => {
      setMsg("Excluído.");
      refresh();
    },
    onError: (err: Error) => setMsg(err.message),
  });

  const uploadFiles = useMutation({
    mutationFn: async (files: FileList | File[]) => {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        form.append("path", currentPath);
        const res = await fetch(apiUrl(`/sites/${siteId}/files/upload`), {
          method: "POST",
          credentials: "include",
          body: form,
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text.includes("message") ? JSON.parse(text).error?.message : "Falha no upload");
        }
      }
    },
    onSuccess: () => {
      setMsg("Upload concluído.");
      refresh();
    },
    onError: (err: Error) => setMsg(err.message),
  });

  const breadcrumbs = currentPath ? currentPath.split("/").filter(Boolean) : [];

  const navigate = (path: string) => {
    setCurrentPath(path);
    setMsg(null);
  };

  const downloadFile = (path: string) => {
    window.open(apiUrl(`/sites/${siteId}/files/download?path=${encodeURIComponent(path)}`), "_blank");
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) uploadFiles.mutate(e.dataTransfer.files);
  };

  const siteRootDisplay = listQuery.data?.siteRoot ?? webroot?.replace(/\/htdocs\/?$/, "") ?? `/var/www/${domain}`;

  return (
    <section className="glass-card space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Gerenciador de arquivos</h2>
          <p className="text-xs text-muted">SFTP via SSH · raiz: <code className="font-mono">{siteRootDisplay}</code></p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => refresh()}
            disabled={listQuery.isFetching}
            className="inline-flex items-center gap-1 rounded-card border border-white/80 bg-white px-2.5 py-1 text-xs text-muted hover:bg-white/90 disabled:opacity-50"
          >
            {listQuery.isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Atualizar
          </button>
          <button
            type="button"
            onClick={() => {
              const name = window.prompt("Nome da nova pasta:");
              if (name?.trim()) mkdir.mutate(name.trim());
            }}
            className="inline-flex items-center gap-1 rounded-card border border-white/80 bg-white px-2.5 py-1 text-xs text-muted hover:bg-white/90"
          >
            <FolderPlus className="h-3 w-3" />
            Nova pasta
          </button>
          <button
            type="button"
            onClick={() => uploadRef.current?.click()}
            disabled={uploadFiles.isPending}
            className="inline-flex items-center gap-1 rounded-card bg-accent px-2.5 py-1 text-xs text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {uploadFiles.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
            Upload
          </button>
          <input
            ref={uploadRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && uploadFiles.mutate(e.target.files)}
          />
        </div>
      </div>

      <nav className="flex flex-wrap items-center gap-1 text-xs text-muted">
        <button type="button" onClick={() => navigate("")} className="inline-flex items-center gap-0.5 hover:text-accent">
          <Home className="h-3 w-3" />
          raiz
        </button>
        {breadcrumbs.map((part, i) => {
          const path = breadcrumbs.slice(0, i + 1).join("/");
          return (
            <span key={path} className="inline-flex items-center gap-1">
              <ChevronRight className="h-3 w-3" />
              <button type="button" onClick={() => navigate(path)} className="hover:text-accent">
                {part}
              </button>
            </span>
          );
        })}
      </nav>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`overflow-hidden rounded-lg border ${dragOver ? "border-accent bg-accent/5" : "border-white/20 bg-[#0d1117]/40"}`}
      >
        {listQuery.isLoading ? (
          <p className="flex items-center gap-2 p-6 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando arquivos…
          </p>
        ) : listQuery.isError ? (
          <p className="p-6 text-sm text-danger">{(listQuery.error as Error).message}</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs text-muted">
                <th className="px-3 py-2 font-medium">Nome</th>
                <th className="hidden px-3 py-2 font-medium sm:table-cell">Tamanho</th>
                <th className="hidden px-3 py-2 font-medium md:table-cell">Modificado</th>
                <th className="px-3 py-2 font-medium text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {currentPath ? (
                <tr
                  className="cursor-pointer border-b border-white/5 hover:bg-white/5"
                  onClick={() => {
                    const parts = currentPath.split("/");
                    parts.pop();
                    navigate(parts.join("/"));
                  }}
                >
                  <td className="px-3 py-2" colSpan={4}>
                    <span className="inline-flex items-center gap-2 text-muted">
                      <Folder className="h-4 w-4" /> ..
                    </span>
                  </td>
                </tr>
              ) : null}
              {(listQuery.data?.entries ?? []).map((entry) => {
                const Icon = fileIcon(entry.name, entry.isDirectory);
                return (
                  <tr
                    key={entry.path}
                    className="border-b border-white/5 hover:bg-white/5"
                    onDoubleClick={() => entry.isDirectory && navigate(entry.path)}
                  >
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="inline-flex max-w-full items-center gap-2 text-left"
                        onClick={() => entry.isDirectory && navigate(entry.path)}
                      >
                        <Icon className={`h-4 w-4 shrink-0 ${entry.isDirectory ? "text-amber-400" : "text-muted"}`} />
                        <span className="truncate font-mono text-xs">{entry.name}</span>
                      </button>
                    </td>
                    <td className="hidden px-3 py-2 font-mono text-xs text-muted sm:table-cell">
                      {entry.isDirectory ? "—" : formatSize(entry.size)}
                    </td>
                    <td className="hidden px-3 py-2 text-xs text-muted md:table-cell">{formatDate(entry.modifiedAt)}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        {!entry.isDirectory && isEditable(entry.name) ? (
                          <button
                            type="button"
                            title="Editar"
                            onClick={() => openEditor.mutate(entry.path)}
                            className="rounded p-1 text-muted hover:bg-white/10 hover:text-accent"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                        {!entry.isDirectory ? (
                          <button
                            type="button"
                            title="Download"
                            onClick={() => downloadFile(entry.path)}
                            className="rounded p-1 text-muted hover:bg-white/10 hover:text-accent"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          title="Excluir"
                          onClick={() => {
                            if (window.confirm(`Excluir "${entry.name}"?`)) remove.mutate(entry.path);
                          }}
                          className="rounded p-1 text-muted hover:bg-white/10 hover:text-danger"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {(listQuery.data?.entries.length ?? 0) === 0 && !listQuery.isLoading ? (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-sm text-muted">
                    Pasta vazia. Arraste arquivos aqui ou use Upload.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        )}
      </div>

      {dragOver ? (
        <p className="text-center text-xs text-accent">Solte os arquivos para enviar</p>
      ) : (
        <p className="text-[11px] text-muted">Arraste arquivos para upload · duplo clique em pastas para abrir · máx. 50 MB por arquivo</p>
      )}

      {msg ? <p className="text-xs text-muted">{msg}</p> : null}

      {editor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl border border-white/20 bg-[#0d1117] shadow-xl">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <span className="font-mono text-sm text-white">{editor.name}</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditor(null)}
                  className="rounded px-3 py-1 text-xs text-muted hover:bg-white/10"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={saveEditor.isPending}
                  onClick={() => saveEditor.mutate()}
                  className="rounded bg-accent px-3 py-1 text-xs text-white hover:bg-accent/90 disabled:opacity-50"
                >
                  {saveEditor.isPending ? "Salvando…" : "Salvar"}
                </button>
              </div>
            </div>
            <textarea
              value={editor.content}
              onChange={(e) => setEditor({ ...editor, content: e.target.value })}
              spellCheck={false}
              className="min-h-[50vh] flex-1 resize-none bg-transparent p-4 font-mono text-xs leading-relaxed text-[#c9d1d9] outline-none"
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}
