import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { AdminPermissions } from "../decorators/admin-permissions.decorator";
import { AdminJwtAuthGuard } from "../guards/admin-jwt-auth.guard";
import { AdminRbacGuard } from "../guards/admin-rbac.guard";
import type { AdminRequest } from "../admin.types";
import { AdminSearchService } from "./admin-search.service";

@Controller("admin/search")
@UseGuards(AdminJwtAuthGuard, AdminRbacGuard)
export class AdminSearchController {
  constructor(private readonly adminSearchService: AdminSearchService) {}

  @Get()
  @AdminPermissions("search.read")
  async search(@Query("q") query: string, @Req() req: AdminRequest) {
    return this.adminSearchService.search(query ?? "", req.adminUser!);
  }
}
