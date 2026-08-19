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

  UseGuards,

  ForbiddenException,

} from "@nestjs/common";

import { FastifyRequest } from "fastify";

import { AuthGuard, CurrentUser } from "../auth/auth.guard";

import { SessionUser } from "../auth/auth.service";

import { SitesService } from "./sites.service";



@Controller("sites")

@UseGuards(AuthGuard)

export class SitesController {

  constructor(private readonly sites: SitesService) {}



  @Get("create-options")
  createOptions(@CurrentUser() user: SessionUser, @Query("serverId") serverId?: string) {
    if (!this.sites.canRead(user)) {
      throw new ForbiddenException({ error: { code: "FORBIDDEN", message: "Permissão insuficiente." } });
    }
    return this.sites.getCreateOptions(user, serverId);
  }

  @Get()
  async list(@CurrentUser() user: SessionUser, @Query("serverId") serverId?: string) {
    if (!this.sites.canRead(user)) {
      throw new ForbiddenException({ error: { code: "FORBIDDEN", message: "Permissão insuficiente." } });
    }
    const items = await this.sites.list(user, { serverId });
    return { sites: items };
  }



  @Get("migrate-targets")
  migrateTargets(@CurrentUser() user: SessionUser) {
    return this.sites.getMigrateTargets(user);
  }

  @Post("migrate")
  migrateFtp(@CurrentUser() user: SessionUser, @Body() body: unknown, @Req() req: FastifyRequest) {
    return this.sites.migrateFtp(user, body, req.ip);
  }

  @Post("migrate/source-test")
  migrateSourceTest(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    return this.sites.testMigrateSource(user, body);
  }

  @Post("migrate/source-browse")
  migrateSourceBrowse(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    return this.sites.browseMigrateSource(user, body);
  }

  @Post()

  async create(@CurrentUser() user: SessionUser, @Body() body: unknown, @Req() req: FastifyRequest) {

    return this.sites.create(user, body, req.ip);

  }



  @Get(":siteId")

  async get(@CurrentUser() user: SessionUser, @Param("siteId") siteId: string) {

    if (!this.sites.canRead(user)) {

      throw new ForbiddenException({ error: { code: "FORBIDDEN", message: "Permissão insuficiente." } });

    }

    return this.sites.get(user, siteId);

  }



  @Post(":siteId/info")

  refreshInfo(@CurrentUser() user: SessionUser, @Param("siteId") siteId: string, @Req() req: FastifyRequest) {

    return this.sites.refreshInfo(user, siteId, req.ip);

  }



  @Post(":siteId/manage")

  manage(

    @CurrentUser() user: SessionUser,

    @Param("siteId") siteId: string,

    @Body() body: unknown,

    @Req() req: FastifyRequest,

  ) {

    return this.sites.manage(user, siteId, body, req.ip);

  }



  @Post(":siteId/ftp-users")

  createFtpUser(

    @CurrentUser() user: SessionUser,

    @Param("siteId") siteId: string,

    @Body() body: unknown,

    @Req() req: FastifyRequest,

  ) {

    return this.sites.createFtpUser(user, siteId, body, req.ip);

  }

  @Delete(":siteId/ftp-users/:ftpUserId")
  deleteFtpUser(
    @CurrentUser() user: SessionUser,
    @Param("siteId") siteId: string,
    @Param("ftpUserId") ftpUserId: string,
    @Req() req: FastifyRequest,
  ) {
    return this.sites.deleteFtpUser(user, siteId, ftpUserId, req.ip);
  }

  @Get(":siteId/ftp-users/:ftpUserId/password")
  getFtpUserPassword(
    @CurrentUser() user: SessionUser,
    @Param("siteId") siteId: string,
    @Param("ftpUserId") ftpUserId: string,
  ) {
    if (!this.sites.canRead(user)) {
      throw new ForbiddenException({ error: { code: "FORBIDDEN", message: "Permissão insuficiente." } });
    }
    return this.sites.getFtpUserPassword(user, siteId, ftpUserId);
  }

  @Post(":siteId/backup")
  backup(@CurrentUser() user: SessionUser, @Param("siteId") siteId: string, @Req() req: FastifyRequest) {
    return this.sites.backup(user, siteId, req.ip);
  }

  @Get(":siteId/backups")
  listBackups(@CurrentUser() user: SessionUser, @Param("siteId") siteId: string) {
    return this.sites.listBackups(user, siteId);
  }

  @Get(":siteId/backup-policy")
  backupPolicy(@CurrentUser() user: SessionUser, @Param("siteId") siteId: string) {
    return this.sites.getBackupPolicy(user, siteId);
  }

  @Patch(":siteId/backup-policy")
  updateBackupPolicy(
    @CurrentUser() user: SessionUser,
    @Param("siteId") siteId: string,
    @Body() body: unknown,
  ) {
    return this.sites.updateBackupPolicy(user, siteId, body);
  }

  @Post(":siteId/restore")
  restore(
    @CurrentUser() user: SessionUser,
    @Param("siteId") siteId: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ) {
    return this.sites.restore(user, siteId, body, req.ip);
  }

  @Post(":siteId/delete")
  deleteSite(
    @CurrentUser() user: SessionUser,
    @Param("siteId") siteId: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ) {
    return this.sites.deleteSite(user, siteId, body, req.ip);
  }

  @Get(":siteId/dns")
  checkDns(@CurrentUser() user: SessionUser, @Param("siteId") siteId: string) {
    return this.sites.checkDns(user, siteId);
  }

  @Post(":siteId/wp-autologin")
  wpAutologin(@CurrentUser() user: SessionUser, @Param("siteId") siteId: string, @Req() req: FastifyRequest) {
    return this.sites.wpAutologin(user, siteId, req.ip);
  }

  @Post(":siteId/update-domain")
  updateDomain(
    @CurrentUser() user: SessionUser,
    @Param("siteId") siteId: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ) {
    return this.sites.updateDomain(user, siteId, body, req.ip);
  }

}


