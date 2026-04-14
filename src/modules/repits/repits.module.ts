import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { RepitsController } from "./repits.controller";
import { RepitsService } from "./repits.service";
import { Repit } from "../../entities";
import { UploadsModule } from "../uploads/uploads.module";

@Module({
  imports: [TypeOrmModule.forFeature([Repit]), UploadsModule],
  controllers: [RepitsController],
  providers: [RepitsService],
})
export class RepitsModule {}
