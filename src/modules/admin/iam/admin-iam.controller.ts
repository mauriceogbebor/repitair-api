import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AdminPermissions } from "../decorators/admin-permissions.decorator";
import { AdminJwtAuthGuard } from "../guards/admin-jwt-auth.guard";
import { AdminRbacGuard } from "../guards/admin-rbac.guard";
import type { AdminRequest } from "../admin.types";
import { AdminAccessReviewDto } from "./dto/admin-access-review.dto";
import { AdminBreakGlassDto } from "./dto/admin-break-glass.dto";
import { AdminInviteAdminDto } from "./dto/admin-invite-admin.dto";
import { AdminListAdminsQueryDto } from "./dto/admin-list-admins-query.dto";
import { AdminReasonDto } from "./dto/admin-reason.dto";
import { AdminUpdateRolesDto } from "./dto/admin-update-roles.dto";
import { AdminIamService } from "./admin-iam.service";

@Controller("admin/iam")
@UseGuards(AdminJwtAuthGuard, AdminRbacGuard)
export class AdminIamController {
  constructor(private readonly iam: AdminIamService) {}

  @Get("admins")
  @AdminPermissions("admins.read")
  listAdmins(@Query() query: AdminListAdminsQueryDto) { return this.iam.listAdmins(query); }

  @Get("admins/:id")
  @AdminPermissions("admins.read")
  getAdmin(@Param("id", ParseUUIDPipe) id: string, @Req() request: AdminRequest) { return this.iam.getAdminDetail(id, request.adminSessionId); }

  @Get("roles")
  @AdminPermissions("admins.read")
  listRoles() { return this.iam.listRoles(); }

  @Post("admins/invite")
  @AdminPermissions("admins.invite")
  invite(@Body() dto: AdminInviteAdminDto, @Req() request: AdminRequest) { return this.iam.invite(dto, request.adminUser!, request.adminRequestContext); }

  @Post("admins/:id/invitation/revoke")
  @AdminPermissions("admins.invite")
  @HttpCode(200)
  revokeInvitation(@Param("id", ParseUUIDPipe) id: string, @Body() dto: AdminReasonDto, @Req() request: AdminRequest) { return this.iam.revokeInvitation(id, dto.reason, request.adminUser!, request.adminRequestContext); }

  @Patch("admins/:id/roles")
  @AdminPermissions("roles.manage")
  updateRoles(@Param("id", ParseUUIDPipe) id: string, @Body() dto: AdminUpdateRolesDto, @Req() request: AdminRequest) { return this.iam.updateRoles(id, dto.roleIds, request.adminUser!, request.adminRequestContext); }

  @Post("admins/:id/sessions/:sessionId/revoke")
  @AdminPermissions("admins.sessions.revoke")
  @HttpCode(200)
  revokeSession(@Param("id", ParseUUIDPipe) id: string, @Param("sessionId", ParseUUIDPipe) sessionId: string, @Body() dto: AdminReasonDto, @Req() request: AdminRequest) { return this.iam.revokeSession(id, sessionId, dto.reason, request.adminUser!, request.adminRequestContext); }

  @Post("admins/:id/sessions/revoke-others")
  @AdminPermissions("admins.sessions.revoke")
  @HttpCode(200)
  revokeOtherSessions(@Param("id", ParseUUIDPipe) id: string, @Body() dto: AdminReasonDto, @Req() request: AdminRequest) { return this.iam.revokeOtherSessions(id, request.adminSessionId, dto.reason, request.adminUser!, request.adminRequestContext); }

  @Post("admins/:id/mfa/reset")
  @AdminPermissions("admins.mfa.reset")
  @HttpCode(200)
  resetMfa(@Param("id", ParseUUIDPipe) id: string, @Body() dto: AdminReasonDto, @Req() request: AdminRequest) { return this.iam.resetMfa(id, false, dto.reason, request.adminUser!, request.adminRequestContext); }

  @Post("admins/:id/mfa/disable")
  @AdminPermissions("admins.mfa.disable")
  @HttpCode(200)
  disableMfa(@Param("id", ParseUUIDPipe) id: string, @Body() dto: AdminReasonDto, @Req() request: AdminRequest) { return this.iam.resetMfa(id, true, dto.reason, request.adminUser!, request.adminRequestContext); }

  @Post("admins/:id/suspend")
  @AdminPermissions("admins.manage")
  @HttpCode(200)
  suspend(@Param("id", ParseUUIDPipe) id: string, @Body() dto: AdminReasonDto, @Req() request: AdminRequest) { return this.iam.setStatus(id, "suspended", dto.reason, request.adminUser!, request.adminRequestContext); }

  @Post("admins/:id/reactivate")
  @AdminPermissions("admins.manage")
  @HttpCode(200)
  reactivate(@Param("id", ParseUUIDPipe) id: string, @Body() dto: AdminReasonDto, @Req() request: AdminRequest) { return this.iam.setStatus(id, "active", dto.reason, request.adminUser!, request.adminRequestContext); }

  @Post("admins/:id/deactivate")
  @AdminPermissions("admins.manage")
  @HttpCode(200)
  deactivate(@Param("id", ParseUUIDPipe) id: string, @Body() dto: AdminReasonDto, @Req() request: AdminRequest) { return this.iam.setStatus(id, "inactive", dto.reason, request.adminUser!, request.adminRequestContext); }

  @Post("admins/:id/access-review")
  @AdminPermissions("admins.access_review")
  @HttpCode(200)
  accessReview(@Param("id", ParseUUIDPipe) id: string, @Body() dto: AdminAccessReviewDto, @Req() request: AdminRequest) { return this.iam.completeAccessReview(id, dto, request.adminUser!, request.adminRequestContext); }

  @Post("admins/:id/break-glass")
  @AdminPermissions("admins.break_glass")
  @HttpCode(200)
  activateBreakGlass(@Param("id", ParseUUIDPipe) id: string, @Body() dto: AdminBreakGlassDto, @Req() request: AdminRequest) { return this.iam.activateBreakGlass(id, dto, request.adminUser!, request.adminRequestContext); }

  @Post("admins/:id/break-glass/:grantId/revoke")
  @AdminPermissions("admins.break_glass")
  @HttpCode(200)
  revokeBreakGlass(@Param("id", ParseUUIDPipe) id: string, @Param("grantId", ParseUUIDPipe) grantId: string, @Req() request: AdminRequest) { return this.iam.revokeBreakGlass(id, grantId, request.adminUser!, request.adminRequestContext); }
}
