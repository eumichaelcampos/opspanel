import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { AuthGuard, CurrentUser, SessionUser } from "../auth/auth.guard";
import { WordpressService } from "./wordpress.service";

@Controller()
@UseGuards(AuthGuard)
export class WordpressController {
  constructor(private readonly wordpress: WordpressService) {}

  @Get("wordpress")
  hub(@CurrentUser() user: SessionUser) {
    return this.wordpress.getHub(user);
  }

  @Get("sites/:siteId/wordpress")
  siteDetail(@CurrentUser() user: SessionUser, @Param("siteId") siteId: string) {
    return this.wordpress.getSiteWordpress(user, siteId);
  }

  @Post("sites/:siteId/wordpress/inventory")
  inventory(@CurrentUser() user: SessionUser, @Param("siteId") siteId: string) {
    return this.wordpress.enqueueInventory(user, siteId);
  }

  @Post("sites/:siteId/wordpress/update")
  update(
    @CurrentUser() user: SessionUser,
    @Param("siteId") siteId: string,
    @Body() body: unknown,
  ) {
    return this.wordpress.enqueueUpdate(user, siteId, body);
  }
}
