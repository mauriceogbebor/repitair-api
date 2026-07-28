import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AdminPermissions } from "../decorators/admin-permissions.decorator";
import { AdminJwtAuthGuard } from "../guards/admin-jwt-auth.guard";
import { AdminRbacGuard } from "../guards/admin-rbac.guard";
import { AdminDashboardService } from "./admin-dashboard.service";
import { AdminDashboardQueryDto } from "./admin-dashboard-query.dto";

@Controller("admin/dashboard")
@UseGuards(AdminJwtAuthGuard, AdminRbacGuard)
export class AdminDashboardController {
  constructor(private readonly adminDashboardService: AdminDashboardService) {}

  @Get()
  @AdminPermissions("dashboard.read")
  async getOverview(@Query() query: AdminDashboardQueryDto) {
    return this.adminDashboardService.getOverview(query);
  }
}
