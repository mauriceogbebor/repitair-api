import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { AdminModule } from "../admin/admin.module";
import { TemplatesController } from "./templates.controller";
import { TemplatesService } from "./templates.service";
import { Template } from "../../entities/template.entity";

@Module({
  imports: [TypeOrmModule.forFeature([Template]), AdminModule],
  controllers: [TemplatesController],
  providers: [TemplatesService],
})
export class TemplatesModule {}
