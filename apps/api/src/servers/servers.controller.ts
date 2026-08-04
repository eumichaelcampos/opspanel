import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { FastifyRequest } from "fastify";
import { AuthGuard, CurrentUser, SessionUser } from "../auth/auth.guard";
import { ServersService } from "./servers.service";

@Controller("servers")
@UseGuards(AuthGuard)
export class ServersController {
  constructor(private readonly servers: ServersService) {}

  @Get("operations-options")
  operationsOptions() {
    return this.servers.getOperationsOptions();
  }

  @Get()
  async list(@CurrentUser() user: SessionUser) {
    const servers = await this.servers.list(user);
    return { servers };
  }

  @Post()
  create(@CurrentUser() user: SessionUser, @Body() body: unknown, @Req() req: FastifyRequest) {
    return this.servers.create(user, body, req.ip);
  }

  @Get(":serverId")
  get(@CurrentUser() user: SessionUser, @Param("serverId") serverId: string) {
    return this.servers.get(user, serverId);
  }

  @Get(":serverId/credential")
  getCredential(
    @CurrentUser() user: SessionUser,
    @Param("serverId") serverId: string,
    @Req() req: FastifyRequest,
  ) {
    return this.servers.getCredential(user, serverId, req.ip);
  }

  @Post(":serverId/test-connection")
  testConnection(
    @CurrentUser() user: SessionUser,
    @Param("serverId") serverId: string,
    @Req() req: FastifyRequest,
  ) {
    return this.servers.testConnection(user, serverId, req.ip);
  }

  @Post(":serverId/sync")
  syncInventory(
    @CurrentUser() user: SessionUser,
    @Param("serverId") serverId: string,
    @Req() req: FastifyRequest,
  ) {
    return this.servers.syncInventory(user, serverId, req.ip);
  }

  @Post(":serverId/health")
  collectHealth(
    @CurrentUser() user: SessionUser,
    @Param("serverId") serverId: string,
    @Req() req: FastifyRequest,
  ) {
    return this.servers.collectHealth(user, serverId, req.ip);
  }

  @Post(":serverId/stack")
  stackAction(
    @CurrentUser() user: SessionUser,
    @Param("serverId") serverId: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ) {
    return this.servers.stackAction(user, serverId, body, req.ip);
  }

  @Post(":serverId/metrics")
  collectMetrics(
    @CurrentUser() user: SessionUser,
    @Param("serverId") serverId: string,
    @Req() req: FastifyRequest,
  ) {
    return this.servers.collectMetrics(user, serverId, req.ip);
  }

  @Post(":serverId/maintenance")
  runMaintenance(
    @CurrentUser() user: SessionUser,
    @Param("serverId") serverId: string,
    @Req() req: FastifyRequest,
  ) {
    return this.servers.runMaintenance(user, serverId, req.ip);
  }

  @Post(":serverId/system/update")
  runSystemUpdate(
    @CurrentUser() user: SessionUser,
    @Param("serverId") serverId: string,
    @Req() req: FastifyRequest,
  ) {
    return this.servers.runSystemUpdate(user, serverId, req.ip);
  }

  @Post(":serverId/wordops/install")
  installWordOps(
    @CurrentUser() user: SessionUser,
    @Param("serverId") serverId: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ) {
    return this.servers.installWordOps(user, serverId, body, req.ip);
  }

  @Post(":serverId/wordops/dashboard/recover")
  recoverWordOpsDashboard(
    @CurrentUser() user: SessionUser,
    @Param("serverId") serverId: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ) {
    return this.servers.recoverWordOpsDashboard(user, serverId, body, req.ip);
  }

  @Post(":serverId/stack/migrate")
  migrateStack(
    @CurrentUser() user: SessionUser,
    @Param("serverId") serverId: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ) {
    return this.servers.migrateStack(user, serverId, body, req.ip);
  }

  @Post(":serverId/ufw/configure")
  configureUfw(
    @CurrentUser() user: SessionUser,
    @Param("serverId") serverId: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ) {
    return this.servers.configureUfw(user, serverId, body, req.ip);
  }

  @Patch(":serverId/connection")
  updateConnection(
    @CurrentUser() user: SessionUser,
    @Param("serverId") serverId: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ) {
    return this.servers.updateConnection(user, serverId, body, req.ip);
  }

  @Patch(":serverId/onboarding")
  patchOnboarding(
    @CurrentUser() user: SessionUser,
    @Param("serverId") serverId: string,
    @Body() body: unknown,
  ) {
    return this.servers.patchOnboarding(user, serverId, body);
  }

  @Delete(":serverId")
  remove(
    @CurrentUser() user: SessionUser,
    @Param("serverId") serverId: string,
    @Req() req: FastifyRequest,
  ) {
    return this.servers.remove(user, serverId, req.ip);
  }

  @Post(":serverId/reboot")
  reboot(
    @CurrentUser() user: SessionUser,
    @Param("serverId") serverId: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ) {
    return this.servers.reboot(user, serverId, body, req.ip);
  }

  @Post(":serverId/stack/restart")
  restartStack(
    @CurrentUser() user: SessionUser,
    @Param("serverId") serverId: string,
    @Req() req: FastifyRequest,
  ) {
    return this.servers.restartStack(user, serverId, req.ip);
  }
}
