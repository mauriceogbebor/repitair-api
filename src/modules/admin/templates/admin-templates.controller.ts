import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { AdminRequest } from "../admin.types";
import { AdminPermissions } from "../decorators/admin-permissions.decorator";
import { AdminJwtAuthGuard } from "../guards/admin-jwt-auth.guard";
import { AdminRbacGuard } from "../guards/admin-rbac.guard";
import { AdminTemplatesService } from "./admin-templates.service";
import { AdminListTemplatesQueryDto } from "./dto/admin-list-templates-query.dto";
import { AdminTemplateActionDto } from "./dto/admin-template-action.dto";
import { AdminTemplateCertifyDto } from "./dto/admin-template-certify.dto";
import { AdminTemplateRollbackDto } from "./dto/admin-template-rollback.dto";
import { AdminUpdateTemplateDto } from "./dto/admin-update-template.dto";
import { AdminUpsertTemplateDto } from "./dto/admin-upsert-template.dto";

@Controller("admin/templates")
@UseGuards(AdminJwtAuthGuard, AdminRbacGuard)
export class AdminTemplatesController {
  constructor(private readonly adminTemplatesService: AdminTemplatesService) {}

  @Get()
  @AdminPermissions("templates.read")
  async listTemplates(@Query() query: AdminListTemplatesQueryDto) {
    return this.adminTemplatesService.listTemplates(query);
  }

  @Get(":id")
  @AdminPermissions("templates.read")
  async getTemplate(@Param("id") templateId: string) {
    return this.adminTemplatesService.getTemplateDetail(templateId);
  }

  @Post()
  @AdminPermissions("templates.write")
  async createTemplate(@Body() dto: AdminUpsertTemplateDto, @Req() req: AdminRequest) {
    return this.adminTemplatesService.createTemplate(dto, req.adminUser, req.adminRequestContext);
  }

  @Patch(":id")
  @AdminPermissions("templates.write")
  async updateTemplate(@Param("id") templateId: string, @Body() dto: AdminUpdateTemplateDto, @Req() req: AdminRequest) {
    return this.adminTemplatesService.updateTemplate(templateId, dto, req.adminUser, req.adminRequestContext);
  }

  @Post(":id/publish")
  @AdminPermissions("templates.publish")
  async publishTemplate(@Param("id") templateId: string, @Body() dto: AdminTemplateActionDto, @Req() req: AdminRequest) {
    return this.adminTemplatesService.publishTemplate(templateId, dto, req.adminUser, req.adminRequestContext);
  }

  @Post(":id/certify")
  @AdminPermissions("templates.certify")
  async certifyTemplate(@Param("id") templateId: string, @Body() dto: AdminTemplateCertifyDto, @Req() req: AdminRequest) {
    return this.adminTemplatesService.certifyTemplate(templateId, dto, req.adminUser, req.adminRequestContext);
  }

  @Post(":id/archive")
  @AdminPermissions("templates.archive")
  async archiveTemplate(@Param("id") templateId: string, @Body() dto: AdminTemplateActionDto, @Req() req: AdminRequest) {
    return this.adminTemplatesService.archiveTemplate(templateId, dto, req.adminUser, req.adminRequestContext);
  }

  @Post(":id/rollback")
  @AdminPermissions("templates.rollback")
  async rollbackTemplate(@Param("id") templateId: string, @Body() dto: AdminTemplateRollbackDto, @Req() req: AdminRequest) {
    return this.adminTemplatesService.rollbackTemplate(templateId, dto, req.adminUser, req.adminRequestContext);
  }

  @Get(":id/versions")
  @AdminPermissions("templates.read")
  async listVersions(@Param("id") templateId: string) {
    return this.adminTemplatesService.listVersions(templateId);
  }

  @Get(":id/history")
  @AdminPermissions("templates.read")
  async listHistory(@Param("id") templateId: string) {
    return this.adminTemplatesService.listHistory(templateId);
  }
}
