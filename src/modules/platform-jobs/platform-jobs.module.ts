import { Global, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PlatformJob } from "../../entities/platform-job.entity";
import { PlatformModule } from "../platform/platform.module";
import { PlatformJobsService } from "./platform-jobs.service";
import { PlatformJobWorker } from "./platform-job.worker";

/**
 * Global so any domain module can inject PlatformJobsService (enqueue +
 * registerHandler) without re-importing. This is the ONE shared execution layer
 * — no module should create its own queue.
 */
@Global()
@Module({
  imports: [PlatformModule, TypeOrmModule.forFeature([PlatformJob])],
  providers: [PlatformJobsService, PlatformJobWorker],
  exports: [PlatformJobsService, PlatformJobWorker],
})
export class PlatformJobsModule {}
