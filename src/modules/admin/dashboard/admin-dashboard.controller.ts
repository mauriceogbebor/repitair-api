import { Controller, Get, UseGuards } from "@nestjs/common";
import { AdminPermissions } from "../decorators/admin-permissions.decorator";
import { AdminJwtAuthGuard } from "../guards/admin-jwt-auth.guard";
import { AdminRbacGuard } from "../guards/admin-rbac.guard";
import { AdminDashboardService } from "./admin-dashboard.service";

@Controller("admin/dashboard")
@UseGuards(AdminJwtAuthGuard, AdminRbacGuard)
export class AdminDashboardController {
  constructor(private readonly adminDashboardService: AdminDashboardService) {}

  @Get()
  @AdminPermissions("dashboard.read")
  async getOverview() {
    return this.adminDashboardService.getOverview();
  }
}
