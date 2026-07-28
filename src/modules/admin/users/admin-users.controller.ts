import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { AdminPermissions } from "../decorators/admin-permissions.decorator";
import { AdminJwtAuthGuard } from "../guards/admin-jwt-auth.guard";
import { AdminRbacGuard } from "../guards/admin-rbac.guard";
import type { AdminRequest } from "../admin.types";
import { AdminUsersService } from "./admin-users.service";
import { AdminListUsersQueryDto } from "./dto/admin-list-users-query.dto";
import { AdminAddUserNoteDto } from "./dto/admin-add-user-note.dto";
import { AdminReactivateUserDto } from "./dto/admin-reactivate-user.dto";
import { AdminSuspendUserDto } from "./dto/admin-suspend-user.dto";
import { AdminUpdateUserDto } from "./dto/admin-update-user.dto";
import { AdminUserRecoveryDto } from "./dto/admin-user-recovery.dto";

@Controller("admin/users")
@UseGuards(AdminJwtAuthGuard, AdminRbacGuard)
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  @Get()
  @AdminPermissions("users.read")
  async listUsers(@Query() query: AdminListUsersQueryDto, @Req() req: AdminRequest) {
    return this.adminUsersService.listUsers(query, req.adminUser);
  }

  @Get("export")
  @AdminPermissions("users.export")
  async exportUsers(
    @Query() query: AdminListUsersQueryDto,
    @Req() req: AdminRequest,
    @Res() response: Response,
  ) {
    const result = await this.adminUsersService.exportUsers(
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
  @AdminPermissions("users.read")
  async getUser(@Param("id") userId: string, @Req() req: AdminRequest) {
    return this.adminUsersService.getUserDetail(userId, req.adminUser, req.adminRequestContext);
  }

  @Patch(":id")
  @AdminPermissions("users.write")
  async updateUser(@Param("id") userId: string, @Body() dto: AdminUpdateUserDto, @Req() req: AdminRequest) {
    return this.adminUsersService.updateUser(userId, dto, req.adminUser, req.adminRequestContext);
  }

  @Post(":id/suspend")
  @AdminPermissions("users.suspend")
  async suspendUser(@Param("id") userId: string, @Body() dto: AdminSuspendUserDto, @Req() req: AdminRequest) {
    return this.adminUsersService.suspendUser(userId, dto, req.adminUser, req.adminRequestContext);
  }

  @Post(":id/reactivate")
  @AdminPermissions("users.suspend")
  async reactivateUser(@Param("id") userId: string, @Body() dto: AdminReactivateUserDto, @Req() req: AdminRequest) {
    return this.adminUsersService.reactivateUser(userId, dto, req.adminUser, req.adminRequestContext);
  }

  @Get(":id/activity")
  @AdminPermissions("users.activity.read")
  async getActivity(@Param("id") userId: string, @Req() req: AdminRequest) {
    return this.adminUsersService.getUserActivity(userId, req.adminUser);
  }

  @Get(":id/diagnostics")
  @AdminPermissions("users.diagnostics.read")
  async getDiagnostics(@Param("id") userId: string, @Req() req: AdminRequest) {
    return this.adminUsersService.getUserDiagnostics(userId, req.adminUser, req.adminRequestContext);
  }

  @Get(":id/operations")
  @AdminPermissions("users.read")
  async getOperations(@Param("id") userId: string, @Req() req: AdminRequest) {
    return this.adminUsersService.getUserOperations(userId, req.adminUser);
  }

  @Post(":id/notes")
  @AdminPermissions("users.notes.create")
  async addNote(@Param("id") userId: string, @Body() dto: AdminAddUserNoteDto, @Req() req: AdminRequest) {
    return this.adminUsersService.addUserNote(userId, dto, req.adminUser, req.adminRequestContext);
  }

  @Post(":id/recovery")
  @AdminPermissions("users.recovery.manage")
  async recoverUser(@Param("id") userId: string, @Body() dto: AdminUserRecoveryDto, @Req() req: AdminRequest) {
    return this.adminUsersService.performRecovery(userId, dto, req.adminUser, req.adminRequestContext);
  }
}
