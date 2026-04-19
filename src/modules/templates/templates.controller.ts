import { Controller, Get, UseGuards } from "@nestjs/common";

import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { TemplatesService } from "./templates.service";

@Controller("templates")
@UseGuards(JwtAuthGuard)
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Get()
  getTemplates() {
    return this.templatesService.findAll();
  }
}
