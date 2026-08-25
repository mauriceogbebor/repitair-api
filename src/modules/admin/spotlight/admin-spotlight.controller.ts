import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { AdminRequest } from "../admin.types";
import { AdminPermissions } from "../decorators/admin-permissions.decorator";
import { AdminJwtAuthGuard } from "../guards/admin-jwt-auth.guard";
import { AdminRbacGuard } from "../guards/admin-rbac.guard";
import { AdminSpotlightService } from "./admin-spotlight.service";
import { AdminCreateSpotlightDto } from "./dto/admin-create-spotlight.dto";
import { AdminListSpotlightQueryDto } from "./dto/admin-list-spotlight-query.dto";
import { AdminScheduleSpotlightDto } from "./dto/admin-schedule-spotlight.dto";
import { AdminSpotlightActionDto } from "./dto/admin-spotlight-action.dto";
import { AdminUpdateSpotlightDto } from "./dto/admin-update-spotlight.dto";

@Controller("admin/spotlight")
@UseGuards(AdminJwtAuthGuard, AdminRbacGuard)
export class AdminSpotlightController {
  constructor(private readonly adminSpotlightService: AdminSpotlightService) {}

  @Get()
  @AdminPermissions("spotlight.read")
  async listCampaigns(@Query() query: AdminListSpotlightQueryDto) {
    return this.adminSpotlightService.listCampaigns(query);
  }

  @Get(":id")
  @AdminPermissions("spotlight.read")
  async getCampaign(@Param("id") campaignId: string) {
    return this.adminSpotlightService.getCampaignDetail(campaignId);
  }

  @Post()
  @AdminPermissions("spotlight.write")
  async createCampaign(@Body() dto: AdminCreateSpotlightDto, @Req() req: AdminRequest) {
    return this.adminSpotlightService.createCampaign(dto, req.adminUser, req.adminRequestContext);
  }

  @Patch(":id")
  @AdminPermissions("spotlight.write")
  async updateCampaign(@Param("id") campaignId: string, @Body() dto: AdminUpdateSpotlightDto, @Req() req: AdminRequest) {
    return this.adminSpotlightService.updateCampaign(campaignId, dto, req.adminUser, req.adminRequestContext);
  }

  @Post(":id/publish")
  @AdminPermissions("spotlight.publish")
  async publishCampaign(@Param("id") campaignId: string, @Body() dto: AdminSpotlightActionDto, @Req() req: AdminRequest) {
    return this.adminSpotlightService.publishCampaign(campaignId, dto, req.adminUser, req.adminRequestContext);
  }

  @Post(":id/pause")
  @AdminPermissions("spotlight.publish")
  async pauseCampaign(@Param("id") campaignId: string, @Body() dto: AdminSpotlightActionDto, @Req() req: AdminRequest) {
    return this.adminSpotlightService.pauseCampaign(campaignId, dto, req.adminUser, req.adminRequestContext);
  }

  @Post(":id/archive")
  @AdminPermissions("spotlight.archive")
  async archiveCampaign(@Param("id") campaignId: string, @Body() dto: AdminSpotlightActionDto, @Req() req: AdminRequest) {
    return this.adminSpotlightService.archiveCampaign(campaignId, dto, req.adminUser, req.adminRequestContext);
  }

  @Post(":id/schedule")
  @AdminPermissions("spotlight.schedule")
  async scheduleCampaign(@Param("id") campaignId: string, @Body() dto: AdminScheduleSpotlightDto, @Req() req: AdminRequest) {
    return this.adminSpotlightService.scheduleCampaign(campaignId, dto, req.adminUser, req.adminRequestContext);
  }

  @Post(":id/duplicate")
  @AdminPermissions("spotlight.write")
  async duplicateCampaign(@Param("id") campaignId: string, @Req() req: AdminRequest) {
    return this.adminSpotlightService.duplicateCampaign(campaignId, req.adminUser, req.adminRequestContext);
  }
}
