import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
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
