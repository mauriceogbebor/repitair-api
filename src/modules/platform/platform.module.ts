import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { FeatureFlag } from "../../entities/feature-flag.entity";
import { PlatformJob } from "../../entities/platform-job.entity";
import { PlatformSetting } from "../../entities/platform-setting.entity";
import { PlatformWorkerHeartbeat } from "../../entities/platform-worker-heartbeat.entity";
import { UploadsModule } from "../uploads/uploads.module";
import { PlatformController } from "./platform.controller";
import { PlatformService } from "./platform.service";

@Module({
  imports: [
    UploadsModule,
    TypeOrmModule.forFeature([
      FeatureFlag,
      PlatformSetting,
      PlatformJob,
      PlatformWorkerHeartbeat,
    ]),
  ],
  controllers: [PlatformController],
  providers: [PlatformService],
  exports: [PlatformService],
})
export class PlatformModule {}
