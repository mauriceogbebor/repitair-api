import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { Spotlight } from "../../entities/spotlight.entity";
import { SpotlightController } from "./spotlight.controller";
import { SpotlightService } from "./spotlight.service";

@Module({
  imports: [TypeOrmModule.forFeature([Spotlight])],
  controllers: [SpotlightController],
  providers: [SpotlightService],
})
export class SpotlightModule {}
