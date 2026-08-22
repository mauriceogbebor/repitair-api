import { BadRequestException, Body, Controller, Get, Param, Patch, Req, UseGuards } from "@nestjs/common";

import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import type { AdminRequest } from "../admin/admin.types";
import { AdminPermissions } from "../admin/decorators/admin-permissions.decorator";
import { AdminJwtAuthGuard } from "../admin/guards/admin-jwt-auth.guard";
import { AdminRbacGuard } from "../admin/guards/admin-rbac.guard";
import { AdminTemplatesService } from "../admin/templates/admin-templates.service";
import { UpdateTemplateCompositionDto } from "./dto/update-template-composition.dto";
import { TemplatesService } from "./templates.service";

@Controller("templates")
export class TemplatesController {
  constructor(
    private readonly templatesService: TemplatesService,
    private readonly adminTemplatesService: AdminTemplatesService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  getTemplates() {
    return this.templatesService.findAll();
  }

  @Patch("admin/:id/composition")
  @UseGuards(AdminJwtAuthGuard, AdminRbacGuard)
  @AdminPermissions("templates.write")
  updateTemplateComposition(
    @Param("id") id: string,
    @Body() body: UpdateTemplateCompositionDto,
    @Req() request: AdminRequest,
  ) {
    if (!body.composition && !body.canvasMeta) {
      throw new BadRequestException("A composition or canvasMeta update is required");
    }
    return this.adminTemplatesService.updateTemplate(id, {
      composition: body.composition ?? undefined,
      canvasMeta: body.canvasMeta ?? undefined,
      changeSummary: "Composition updated through compatibility endpoint",
    }, request.adminUser, request.adminRequestContext);
  }
}
