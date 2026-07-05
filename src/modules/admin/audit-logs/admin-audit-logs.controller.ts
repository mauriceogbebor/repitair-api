import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AdminPermissions } from "../decorators/admin-permissions.decorator";
import { AdminJwtAuthGuard } from "../guards/admin-jwt-auth.guard";
import { AdminRbacGuard } from "../guards/admin-rbac.guard";
import { AdminAuditLogsService } from "./admin-audit-logs.service";

@Controller("admin/audit-logs")
@UseGuards(AdminJwtAuthGuard, AdminRbacGuard)
export class AdminAuditLogsController {
  constructor(private readonly adminAuditLogsService: AdminAuditLogsService) {}

  @Get()
  @AdminPermissions("audit.read")
  async listRecent(@Query("limit") limit?: string) {
    const parsedLimit = limit ? Number.parseInt(limit, 10) : 50;
    const records = await this.adminAuditLogsService.listRecent(parsedLimit);
    return {
      total: records.length,
      records,
    };
  }
}
