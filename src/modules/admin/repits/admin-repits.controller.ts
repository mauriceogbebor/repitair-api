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
import { AdminRepitModerationService } from "./admin-repit-moderation.service";
import { AdminListModerationReportsQueryDto } from "./dto/admin-list-moderation-reports-query.dto";
import { AdminAssignModerationReportDto } from "./dto/admin-assign-moderation-report.dto";
import { AdminAddModerationNoteDto } from "./dto/admin-add-moderation-note.dto";
import { AdminModerationDecisionDto } from "./dto/admin-moderation-decision.dto";
import { AdminOpenModerationReportDto } from "./dto/admin-open-moderation-report.dto";

@Controller("admin/repits")
@UseGuards(AdminJwtAuthGuard, AdminRbacGuard)
export class AdminRepitsController {
  constructor(
    private readonly adminRepitsService: AdminRepitsService,
    private readonly moderationService: AdminRepitModerationService,
  ) {}

  @Get()
  @AdminPermissions("repits.read")
  async listRepits(@Query() query: AdminListRepitsQueryDto, @Req() req: AdminRequest) {
    return this.adminRepitsService.listRepits(query, req.adminUser);
  }

  @Get("reports")
  @AdminPermissions("repits.review")
  async listReports(@Query() query: AdminListModerationReportsQueryDto, @Req() req: AdminRequest) {
    return this.moderationService.listReports(query, req.adminUser);
  }

  @Get("policies")
  @AdminPermissions("repits.policy")
  getPolicies() {
    return this.moderationService.listPolicies();
  }

  @Get("reviewers")
  @AdminPermissions("repits.assign")
  listReviewers() {
    return this.moderationService.listReviewers();
  }

  @Post("reports/:reportId/assignment")
  @AdminPermissions("repits.assign")
  assignReport(@Param("reportId") reportId: string, @Body() dto: AdminAssignModerationReportDto, @Req() req: AdminRequest) {
    return this.moderationService.assignReport(reportId, dto, req.adminUser, req.adminRequestContext);
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
  async getRepit(@Param("id") repitId: string, @Req() req: AdminRequest) {
    return this.adminRepitsService.getRepitDetail(repitId, req.adminUser);
  }

  @Get(":id/moderation")
  @AdminPermissions("repits.review")
  getModerationContext(@Param("id") repitId: string, @Req() req: AdminRequest) {
    return this.moderationService.getModerationContext(repitId, req.adminUser);
  }

  @Post(":id/reports")
  @AdminPermissions("repits.review")
  async openReport(@Param("id") repitId: string, @Body() dto: AdminOpenModerationReportDto, @Req() req: AdminRequest) {
    await this.moderationService.openReport(repitId, dto, req.adminUser, req.adminRequestContext);
    return this.moderationService.getModerationContext(repitId, req.adminUser);
  }

  @Post(":id/moderation/notes")
  @AdminPermissions("repits.notes")
  addModerationNote(@Param("id") repitId: string, @Body() dto: AdminAddModerationNoteDto, @Req() req: AdminRequest) {
    return this.moderationService.addNote(repitId, dto, req.adminUser, req.adminRequestContext);
  }

  @Post(":id/moderation/decisions")
  @AdminPermissions("repits.decision")
  decide(@Param("id") repitId: string, @Body() dto: AdminModerationDecisionDto, @Req() req: AdminRequest) {
    return this.moderationService.decide(repitId, dto, req.adminUser, req.adminRequestContext);
  }

  @Post(":id/flag")
  @AdminPermissions("repits.moderate")
  async flagRepit(@Param("id") repitId: string, @Body() dto: AdminFlagRepitDto, @Req() req: AdminRequest) {
    return this.adminRepitsService.flagRepit(repitId, dto, req.adminUser, req.adminRequestContext);
  }

  @Post(":id/archive")
  @AdminPermissions("repits.moderate", "repits.decision")
  async archiveRepit(@Param("id") repitId: string, @Body() dto: AdminArchiveRepitDto, @Req() req: AdminRequest) {
    return this.adminRepitsService.archiveRepit(repitId, dto, req.adminUser, req.adminRequestContext);
  }

  @Delete(":id")
  @AdminPermissions("repits.delete", "repits.decision")
  async deleteRepit(@Param("id") repitId: string, @Body() dto: AdminFlagRepitDto, @Req() req: AdminRequest) {
    return this.adminRepitsService.deleteRepit(repitId, dto, req.adminUser, req.adminRequestContext);
  }
}
