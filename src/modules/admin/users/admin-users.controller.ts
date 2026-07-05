import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AdminPermissions } from "../decorators/admin-permissions.decorator";
import { AdminJwtAuthGuard } from "../guards/admin-jwt-auth.guard";
import { AdminRbacGuard } from "../guards/admin-rbac.guard";
import type { AdminRequest } from "../admin.types";
import { AdminUsersService } from "./admin-users.service";
import { AdminListUsersQueryDto } from "./dto/admin-list-users-query.dto";
import { AdminReactivateUserDto } from "./dto/admin-reactivate-user.dto";
import { AdminSuspendUserDto } from "./dto/admin-suspend-user.dto";
import { AdminUpdateUserDto } from "./dto/admin-update-user.dto";

@Controller("admin/users")
@UseGuards(AdminJwtAuthGuard, AdminRbacGuard)
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  @Get()
  @AdminPermissions("users.read")
  async listUsers(@Query() query: AdminListUsersQueryDto) {
    return this.adminUsersService.listUsers(query);
  }

  @Get(":id")
  @AdminPermissions("users.read")
  async getUser(@Param("id") userId: string) {
    return this.adminUsersService.getUserDetail(userId);
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
  @AdminPermissions("users.read")
  async getActivity(@Param("id") userId: string) {
    return this.adminUsersService.getUserActivity(userId);
  }

  @Get(":id/diagnostics")
  @AdminPermissions("users.read")
  async getDiagnostics(@Param("id") userId: string) {
    return this.adminUsersService.getUserDiagnostics(userId);
  }
}
