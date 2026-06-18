import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { AdminEmailGuard } from "../../common/guards/admin-email.guard";
import { TemplatesController } from "./templates.controller";
import { TemplatesService } from "./templates.service";
import { Template } from "../../entities/template.entity";

@Module({
  imports: [TypeOrmModule.forFeature([Template])],
  controllers: [TemplatesController],
  providers: [TemplatesService, AdminEmailGuard],
})
export class TemplatesModule {}
