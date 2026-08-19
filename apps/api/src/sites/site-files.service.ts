import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from "@nestjs/common";
import { OrgRole } from "@opspanel/database";
import type { SiteInfoSnapshot } from "@opspanel/contracts";
import { posix } from "node:path";
import { AuditService } from "../audit/audit.service";
import { SessionUser } from "../auth/auth.guard";
import { PrismaService } from "../prisma/prisma.service";
import { ServersService } from "../servers/servers.service";
import {
  listDirectory,
  mkdirRemote,
  readFileBuffer,
  removeDirectory,
  removeRemote,
  renameRemote,
  statRemote,
  withSftp,
  writeFileBuffer,
} from "../ssh/sftp-client.js";
import { formatSshError, SshTarget } from "../ssh/ssh-shell.js";

export type SiteFileEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: string;
  permissions: string;
};

const MAX_READ_BYTES = 2 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

@Injectable()
export class SiteFilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly servers: ServersService,
    private readonly audit: AuditService,
  ) {}

  private assertWrite(user: SessionUser) {
    const allowed: OrgRole[] = [OrgRole.owner, OrgRole.admin, OrgRole.operator, OrgRole.developer];
    if (!allowed.includes(user.role)) {
      throw new ForbiddenException({ error: { code: "FORBIDDEN", message: "Permissão insuficiente." } });
    }
  }

  /** Diretório base do site no WordOps (/var/www/domain). */
  resolveSiteBase(domain: string, info?: SiteInfoSnapshot | null): string {
    const webroot = info?.webroot?.replace(/\/+$/, "");
    if (webroot) {
      if (webroot.endsWith("/htdocs")) return webroot.slice(0, -"/htdocs".length);
      return webroot;
    }
    return `/var/www/${domain}`;
  }

  /** Raiz exibida no gerenciador (document root: htdocs quando existir). */
  resolveSiteRoot(domain: string, info?: SiteInfoSnapshot | null): string {
    const base = this.resolveSiteBase(domain, info);
    const webroot = info?.webroot?.replace(/\/+$/, "");
    if (webroot?.endsWith("/htdocs")) return webroot;
    return `${base}/htdocs`;
  }

  resolveSafePath(siteBase: string, relativePath: string): string {
    const clean = relativePath.replace(/\\/g, "/").trim();
    const normalized = posix.normalize(clean.startsWith("/") ? clean : `/${clean}`);
    const relative = normalized.replace(/^\/+/, "");
    const full = relative ? posix.join(siteBase, relative) : siteBase;
    if (full !== siteBase && !full.startsWith(`${siteBase}/`)) {
      throw new ForbiddenException({
        error: { code: "PATH_FORBIDDEN", message: "Caminho fora do diretório do site." },
      });
    }
    if (full.includes("..")) {
      throw new ForbiddenException({
        error: { code: "PATH_FORBIDDEN", message: "Caminho inválido." },
      });
    }
    return full;
  }

  private async getSiteContext(user: SessionUser, siteId: string) {
    const site = await this.prisma.client.site.findFirst({
      where: { id: siteId, organizationId: user.organizationId, deletedAt: null },
      include: { server: { select: { id: true, credential: true } } },
    });
    if (!site) {
      throw new NotFoundException({ error: { code: "SITE_NOT_FOUND", message: "Site não encontrado." } });
    }
    if (!site.server.credential) {
      throw new BadRequestException({
        error: { code: "SSH_NOT_CONFIGURED", message: "Servidor sem credencial SSH configurada." },
      });
    }
    const info = site.infoSnapshot as SiteInfoSnapshot | null;
    const siteBase = this.resolveSiteBase(site.domain, info);
    const siteRoot = this.resolveSiteRoot(site.domain, info);
    const sshTarget = await this.servers.getSshTarget(user, site.server.id);
    return { site, siteBase, siteRoot, sshTarget };
  }

  private toEntry(siteRoot: string, parentPath: string, name: string, attrs: {
    size: number;
    mtime: number;
    mode: number;
    isDirectory(): boolean;
  }): SiteFileEntry {
    const path = parentPath === siteRoot ? name : posix.relative(siteRoot, posix.join(parentPath, name));
    const mode = attrs.mode & 0o777;
    const permissions = [
      mode & 0o400 ? "r" : "-",
      mode & 0o200 ? "w" : "-",
      mode & 0o100 ? "x" : "-",
      mode & 0o040 ? "r" : "-",
      mode & 0o020 ? "w" : "-",
      mode & 0o010 ? "x" : "-",
      mode & 0o004 ? "r" : "-",
      mode & 0o002 ? "w" : "-",
      mode & 0o001 ? "x" : "-",
    ].join("");
    return {
      name,
      path: path || name,
      isDirectory: attrs.isDirectory(),
      size: attrs.size,
      modifiedAt: new Date(attrs.mtime * 1000).toISOString(),
      permissions,
    };
  }

  private async runSftp<T>(target: SshTarget, fn: (sftp: import("ssh2").SFTPWrapper) => Promise<T>): Promise<T> {
    try {
      return await withSftp(target, fn);
    } catch (err) {
      throw new BadRequestException({
        error: { code: "SFTP_ERROR", message: formatSshError(err, target) },
      });
    }
  }

  async list(user: SessionUser, siteId: string, relativePath: string, ip?: string) {
    const { site, siteRoot, sshTarget } = await this.getSiteContext(user, siteId);
    const remotePath = this.resolveSafePath(siteRoot, relativePath);

    const entries = await this.runSftp(sshTarget, async (sftp) => {
      const list = await listDirectory(sftp, remotePath);
      return list
        .filter((e) => e.filename !== "." && e.filename !== "..")
        .map((e) => this.toEntry(siteRoot, remotePath, e.filename, e.attrs))
        .sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
    });

    await this.audit.log({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "site.files.list",
      targetType: "site",
      targetId: siteId,
      result: "success",
      ipAddress: ip,
      metadata: { path: relativePath || "/", domain: site.domain },
    });

    return {
      siteRoot,
      path: relativePath.replace(/^\/+/, "") || "",
      entries,
    };
  }

  async readContent(user: SessionUser, siteId: string, relativePath: string) {
    const { siteRoot, sshTarget } = await this.getSiteContext(user, siteId);
    const remotePath = this.resolveSafePath(siteRoot, relativePath);

    const result = await this.runSftp(sshTarget, async (sftp) => {
      const stat = await statRemote(sftp, remotePath);
      if (stat.isDirectory()) {
        throw new BadRequestException({ error: { code: "IS_DIRECTORY", message: "É um diretório." } });
      }
      if (stat.size > MAX_READ_BYTES) {
        throw new PayloadTooLargeException({
          error: { code: "FILE_TOO_LARGE", message: `Arquivo maior que ${MAX_READ_BYTES / 1024 / 1024} MB.` },
        });
      }
      const buf = await readFileBuffer(sftp, remotePath);
      const isBinary = buf.includes(0);
      return {
        path: relativePath,
        size: stat.size,
        modifiedAt: new Date(stat.mtime * 1000).toISOString(),
        encoding: isBinary ? ("base64" as const) : ("utf8" as const),
        content: isBinary ? buf.toString("base64") : buf.toString("utf8"),
      };
    });

    return result;
  }

  async download(user: SessionUser, siteId: string, relativePath: string) {
    const { siteRoot, sshTarget } = await this.getSiteContext(user, siteId);
    const remotePath = this.resolveSafePath(siteRoot, relativePath);

    return this.runSftp(sshTarget, async (sftp) => {
      const stat = await statRemote(sftp, remotePath);
      if (stat.isDirectory()) {
        throw new BadRequestException({ error: { code: "IS_DIRECTORY", message: "É um diretório." } });
      }
      if (stat.size > MAX_UPLOAD_BYTES) {
        throw new PayloadTooLargeException({
          error: { code: "FILE_TOO_LARGE", message: "Arquivo muito grande para download direto." },
        });
      }
      const buf = await readFileBuffer(sftp, remotePath);
      const filename = posix.basename(remotePath);
      return { filename, buffer: buf, size: stat.size };
    });
  }

  async upload(user: SessionUser, siteId: string, relativeDir: string, filename: string, data: Buffer, ip?: string) {
    this.assertWrite(user);
    if (!filename || filename.includes("/") || filename.includes("..")) {
      throw new BadRequestException({ error: { code: "INVALID_FILENAME", message: "Nome de arquivo inválido." } });
    }
    if (data.length > MAX_UPLOAD_BYTES) {
      throw new PayloadTooLargeException({
        error: { code: "FILE_TOO_LARGE", message: `Upload máximo: ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` },
      });
    }

    const { site, siteRoot, sshTarget } = await this.getSiteContext(user, siteId);
    const dirPath = this.resolveSafePath(siteRoot, relativeDir);
    const remotePath = posix.join(dirPath, filename);

    await this.runSftp(sshTarget, async (sftp) => {
      await writeFileBuffer(sftp, remotePath, data);
    });

    await this.audit.log({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "site.files.upload",
      targetType: "site",
      targetId: siteId,
      result: "success",
      ipAddress: ip,
      metadata: { path: remotePath, size: data.length, domain: site.domain },
    });

    return { ok: true, path: posix.relative(siteRoot, remotePath) };
  }

  async saveContent(user: SessionUser, siteId: string, relativePath: string, content: string, ip?: string) {
    this.assertWrite(user);
    const { site, siteRoot, sshTarget } = await this.getSiteContext(user, siteId);
    const remotePath = this.resolveSafePath(siteRoot, relativePath);
    const data = Buffer.from(content, "utf8");
    if (data.length > MAX_READ_BYTES) {
      throw new PayloadTooLargeException({ error: { code: "FILE_TOO_LARGE", message: "Conteúdo muito grande." } });
    }

    await this.runSftp(sshTarget, async (sftp) => {
      await writeFileBuffer(sftp, remotePath, data);
    });

    await this.audit.log({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "site.files.save",
      targetType: "site",
      targetId: siteId,
      result: "success",
      ipAddress: ip,
      metadata: { path: relativePath, domain: site.domain },
    });

    return { ok: true };
  }

  async mkdir(user: SessionUser, siteId: string, relativePath: string, ip?: string) {
    this.assertWrite(user);
    const { site, siteRoot, sshTarget } = await this.getSiteContext(user, siteId);
    const remotePath = this.resolveSafePath(siteRoot, relativePath);

    await this.runSftp(sshTarget, async (sftp) => {
      await mkdirRemote(sftp, remotePath);
    });

    await this.audit.log({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "site.files.mkdir",
      targetType: "site",
      targetId: siteId,
      result: "success",
      ipAddress: ip,
      metadata: { path: relativePath, domain: site.domain },
    });

    return { ok: true };
  }

  async delete(user: SessionUser, siteId: string, relativePath: string, ip?: string) {
    this.assertWrite(user);
    const { site, siteRoot, sshTarget } = await this.getSiteContext(user, siteId);
    const remotePath = this.resolveSafePath(siteRoot, relativePath);
    if (remotePath === siteRoot) {
      throw new ForbiddenException({ error: { code: "PATH_FORBIDDEN", message: "Não é possível excluir a raiz do site." } });
    }

    await this.runSftp(sshTarget, async (sftp) => {
      const stat = await statRemote(sftp, remotePath);
      if (stat.isDirectory()) await removeDirectory(sftp, remotePath);
      else await removeRemote(sftp, remotePath);
    });

    await this.audit.log({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "site.files.delete",
      targetType: "site",
      targetId: siteId,
      result: "success",
      ipAddress: ip,
      metadata: { path: relativePath, domain: site.domain },
    });

    return { ok: true };
  }

  async rename(user: SessionUser, siteId: string, fromPath: string, toPath: string, ip?: string) {
    this.assertWrite(user);
    const { site, siteRoot, sshTarget } = await this.getSiteContext(user, siteId);
    const from = this.resolveSafePath(siteRoot, fromPath);
    const to = this.resolveSafePath(siteRoot, toPath);
    if (from === siteRoot || to === siteRoot) {
      throw new ForbiddenException({ error: { code: "PATH_FORBIDDEN", message: "Operação não permitida na raiz." } });
    }

    await this.runSftp(sshTarget, async (sftp) => {
      await renameRemote(sftp, from, to);
    });

    await this.audit.log({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "site.files.rename",
      targetType: "site",
      targetId: siteId,
      result: "success",
      ipAddress: ip,
      metadata: { from: fromPath, to: toPath, domain: site.domain },
    });

    return { ok: true };
  }
}
