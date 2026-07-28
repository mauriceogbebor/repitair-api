import { Controller, Get, Param, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { AdminPermissions } from "../decorators/admin-permissions.decorator";
import { AdminJwtAuthGuard } from "../guards/admin-jwt-auth.guard";
import { AdminRbacGuard } from "../guards/admin-rbac.guard";
import { AdminAuditLogsService } from "./admin-audit-logs.service";
import type { AdminRequest } from "../admin.types";
import { AdminListAuditLogsQueryDto } from "./dto/admin-list-audit-logs-query.dto";

@Controller("admin/audit-logs")
@UseGuards(AdminJwtAuthGuard, AdminRbacGuard)
export class AdminAuditLogsController {
  constructor(private readonly adminAuditLogsService: AdminAuditLogsService) {}

  @Get()
  @AdminPermissions("audit.read")
  async list(@Query() query: AdminListAuditLogsQueryDto) {
    return this.adminAuditLogsService.list(query);
  }

  @Get("export")
  @AdminPermissions("audit.export")
  async export(
    @Query() query: AdminListAuditLogsQueryDto,
    @Req() req: AdminRequest,
    @Res() response: Response,
  ) {
    const result = await this.adminAuditLogsService.export(query, req.adminUser, req.adminRequestContext);
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
    response.setHeader("X-Export-Result-Count", String(result.resultCount));
    response.setHeader("X-Export-Limit", String(result.limit));
    response.setHeader("X-Export-Truncated", String(result.truncated));
    response.send(result.csv);
  }

  @Get(":id")
  @AdminPermissions("audit.read")
  async getDetail(@Param("id") id: string, @Req() req: AdminRequest) {
    return this.adminAuditLogsService.getDetail(id, req.adminUser, req.adminRequestContext);
  }
}
