import { Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { AdminPermissions } from "../decorators/admin-permissions.decorator";
import { AdminJwtAuthGuard } from "../guards/admin-jwt-auth.guard";
import { AdminRbacGuard } from "../guards/admin-rbac.guard";
import { AdminMediaService } from "./admin-media.service";

@Controller("admin/media")
@UseGuards(AdminJwtAuthGuard, AdminRbacGuard)
export class AdminMediaController {
  constructor(private readonly media: AdminMediaService) {}

  @Get("overview")
  @AdminPermissions("media.read")
  overview() {
    return this.media.overview();
  }

  @Get("assets")
  @AdminPermissions("media.read")
  list(
    @Query("status") status?: string,
    @Query("provider") provider?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.media.list({ status, provider, from, to, page: page ? Number(page) : undefined, pageSize: pageSize ? Number(pageSize) : undefined });
  }

  @Get("assets/:id")
  @AdminPermissions("media.read")
  inspect(@Param("id", ParseUUIDPipe) id: string) {
    return this.media.inspect(id);
  }

  @Post("assets/:id/retry")
  @AdminPermissions("media.manage")
  retry(@Param("id", ParseUUIDPipe) id: string) {
    return this.media.retry(id);
  }

  @Post("assets/:id/regenerate")
  @AdminPermissions("media.manage")
  regenerate(@Param("id", ParseUUIDPipe) id: string) {
    return this.media.regenerate(id);
  }
}
