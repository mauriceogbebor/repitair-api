import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { FeatureFlag } from "../../entities/feature-flag.entity";
import { PlatformSetting } from "../../entities/platform-setting.entity";
import { PlatformController } from "./platform.controller";
import { PlatformService } from "./platform.service";

@Module({
  imports: [TypeOrmModule.forFeature([FeatureFlag, PlatformSetting])],
  controllers: [PlatformController],
  providers: [PlatformService],
  exports: [PlatformService],
})
export class PlatformModule {}
