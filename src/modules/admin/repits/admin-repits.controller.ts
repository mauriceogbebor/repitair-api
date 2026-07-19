import { Body, Controller, Delete, Get, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { AdminPermissions } from "../decorators/admin-permissions.decorator";
import { AdminJwtAuthGuard } from "../guards/admin-jwt-auth.guard";
import { AdminRbacGuard } from "../guards/admin-rbac.guard";
import type { AdminRequest } from "../admin.types";
import { AdminArchiveRepitDto } from "./dto/admin-archive-repit.dto";
import { AdminFlagRepitDto } from "./dto/admin-flag-repit.dto";
import { AdminListRepitsQueryDto } from "./dto/admin-list-repits-query.dto";
import { AdminRepitsService } from "./admin-repits.service";

@Controller("admin/repits")
@UseGuards(AdminJwtAuthGuard, AdminRbacGuard)
export class AdminRepitsController {
  constructor(private readonly adminRepitsService: AdminRepitsService) {}

  @Get()
  @AdminPermissions("repits.read")
  async listRepits(@Query() query: AdminListRepitsQueryDto) {
    return this.adminRepitsService.listRepits(query);
  }

  @Get("export")
  @AdminPermissions("repits.export")
  async exportRepits(
    @Query() query: AdminListRepitsQueryDto,
    @Req() req: AdminRequest,
    @Res() response: Response,
  ) {
    const result = await this.adminRepitsService.exportRepits(
      query,
      req.adminUser,
      req.adminRequestContext,
    );
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
    response.setHeader("X-Export-Result-Count", String(result.resultCount));
    response.setHeader("X-Export-Limit", String(result.limit));
    response.setHeader("X-Export-Truncated", String(result.truncated));
    response.send(result.csv);
  }

  @Get(":id")
  @AdminPermissions("repits.read")
  async getRepit(@Param("id") repitId: string) {
    return this.adminRepitsService.getRepitDetail(repitId);
  }

  @Post(":id/flag")
  @AdminPermissions("repits.moderate")
  async flagRepit(@Param("id") repitId: string, @Body() dto: AdminFlagRepitDto, @Req() req: AdminRequest) {
    return this.adminRepitsService.flagRepit(repitId, dto, req.adminUser, req.adminRequestContext);
  }

  @Post(":id/archive")
  @AdminPermissions("repits.moderate")
  async archiveRepit(@Param("id") repitId: string, @Body() dto: AdminArchiveRepitDto, @Req() req: AdminRequest) {
    return this.adminRepitsService.archiveRepit(repitId, dto, req.adminUser, req.adminRequestContext);
  }

  @Delete(":id")
  @AdminPermissions("repits.delete")
  async deleteRepit(@Param("id") repitId: string, @Req() req: AdminRequest) {
    return this.adminRepitsService.deleteRepit(repitId, req.adminUser, req.adminRequestContext);
  }
}
