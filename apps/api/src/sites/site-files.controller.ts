import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  ForbiddenException,
} from "@nestjs/common";
import { FastifyReply, FastifyRequest } from "fastify";
import { AuthGuard, CurrentUser } from "../auth/auth.guard";
import { SessionUser } from "../auth/auth.service";
import { SitesService } from "./sites.service";
import { SiteFilesService } from "./site-files.service";

@Controller("sites/:siteId/files")
@UseGuards(AuthGuard)
export class SiteFilesController {
  constructor(
    private readonly sites: SitesService,
    private readonly files: SiteFilesService,
  ) {}

  private assertRead(user: SessionUser) {
    if (!this.sites.canRead(user)) {
      throw new ForbiddenException({ error: { code: "FORBIDDEN", message: "Permissão insuficiente." } });
    }
  }

  private assertWrite(user: SessionUser) {
    try {
      this.sites.assertWrite(user);
    } catch {
      throw new ForbiddenException({ error: { code: "FORBIDDEN", message: "Permissão insuficiente para alterar arquivos." } });
    }
  }

  @Get()
  list(
    @CurrentUser() user: SessionUser,
    @Param("siteId") siteId: string,
    @Query("path") path = "",
    @Req() req: FastifyRequest,
  ) {
    this.assertRead(user);
    return this.files.list(user, siteId, path, req.ip);
  }

  @Get("content")
  readContent(
    @CurrentUser() user: SessionUser,
    @Param("siteId") siteId: string,
    @Query("path") path: string,
  ) {
    this.assertRead(user);
    if (!path) throw new ForbiddenException({ error: { code: "VALIDATION_ERROR", message: "Informe path." } });
    return this.files.readContent(user, siteId, path);
  }

  @Get("download")
  async download(
    @CurrentUser() user: SessionUser,
    @Param("siteId") siteId: string,
    @Query("path") path: string,
    @Res() res: FastifyReply,
  ) {
    this.assertRead(user);
    if (!path) throw new ForbiddenException({ error: { code: "VALIDATION_ERROR", message: "Informe path." } });
    const file = await this.files.download(user, siteId, path);
    return res
      .header("Content-Type", "application/octet-stream")
      .header("Content-Disposition", `attachment; filename="${file.filename}"`)
      .header("Content-Length", file.size)
      .send(file.buffer);
  }

  @Post("upload")
  async upload(
    @CurrentUser() user: SessionUser,
    @Param("siteId") siteId: string,
    @Req() req: FastifyRequest,
  ) {
    this.assertWrite(user);
    let dir = "";
    let filename = "";
    let buffer: Buffer | null = null;

    for await (const part of req.parts()) {
      if (part.type === "file") {
        filename = part.filename;
        buffer = await part.toBuffer();
      } else if (part.fieldname === "path") {
        dir = String(part.value ?? "");
      }
    }

    if (!buffer || !filename) {
      throw new ForbiddenException({ error: { code: "VALIDATION_ERROR", message: "Arquivo não enviado." } });
    }

    return this.files.upload(user, siteId, dir, filename, buffer, req.ip);
  }

  @Post("mkdir")
  mkdir(
    @CurrentUser() user: SessionUser,
    @Param("siteId") siteId: string,
    @Body() body: { path: string },
    @Req() req: FastifyRequest,
  ) {
    this.assertWrite(user);
    return this.files.mkdir(user, siteId, body.path, req.ip);
  }

  @Patch("content")
  saveContent(
    @CurrentUser() user: SessionUser,
    @Param("siteId") siteId: string,
    @Body() body: { path: string; content: string },
    @Req() req: FastifyRequest,
  ) {
    this.assertWrite(user);
    return this.files.saveContent(user, siteId, body.path, body.content, req.ip);
  }

  @Patch("rename")
  rename(
    @CurrentUser() user: SessionUser,
    @Param("siteId") siteId: string,
    @Body() body: { from: string; to: string },
    @Req() req: FastifyRequest,
  ) {
    this.assertWrite(user);
    return this.files.rename(user, siteId, body.from, body.to, req.ip);
  }

  @Delete()
  delete(
    @CurrentUser() user: SessionUser,
    @Param("siteId") siteId: string,
    @Query("path") path: string,
    @Req() req: FastifyRequest,
  ) {
    this.assertWrite(user);
    if (!path) throw new ForbiddenException({ error: { code: "VALIDATION_ERROR", message: "Informe path." } });
    return this.files.delete(user, siteId, path, req.ip);
  }
}
