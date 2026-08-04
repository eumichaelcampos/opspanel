import {

  Body,

  Controller,

  Get,

  Param,

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
  createOptions(@CurrentUser() user: SessionUser) {
    if (!this.sites.canRead(user)) {
      throw new ForbiddenException({ error: { code: "FORBIDDEN", message: "Permissão insuficiente." } });
    }
    return this.sites.getCreateOptions();
  }

  @Get()
  async list(@CurrentUser() user: SessionUser, @Query("serverId") serverId?: string) {
    if (!this.sites.canRead(user)) {
      throw new ForbiddenException({ error: { code: "FORBIDDEN", message: "Permissão insuficiente." } });
    }
    const items = await this.sites.list(user, { serverId });
    return { sites: items };
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

  @Post(":siteId/backup")
  backup(@CurrentUser() user: SessionUser, @Param("siteId") siteId: string, @Req() req: FastifyRequest) {
    return this.sites.backup(user, siteId, req.ip);
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


