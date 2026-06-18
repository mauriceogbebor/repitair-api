import { Body, Controller, Get, Param, Patch, UseGuards } from "@nestjs/common";

import { AdminEmailGuard } from "../../common/guards/admin-email.guard";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { UpdateTemplateCompositionDto } from "./dto/update-template-composition.dto";
import { TemplatesService } from "./templates.service";

@Controller("templates")
@UseGuards(JwtAuthGuard)
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Get()
  getTemplates() {
    return this.templatesService.findAll();
  }

  @Patch("admin/:id/composition")
  @UseGuards(AdminEmailGuard)
  updateTemplateComposition(
    @Param("id") id: string,
    @Body() body: UpdateTemplateCompositionDto,
  ) {
    return this.templatesService.updateComposition(id, body);
  }
}
