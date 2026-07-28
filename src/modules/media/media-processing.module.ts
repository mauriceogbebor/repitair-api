import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AnalyticsEvent } from "../../entities/analytics-event.entity";
import { MediaAsset } from "../../entities/media-asset.entity";
import { MediaDerivative } from "../../entities/media-derivative.entity";
import { PlatformJobsModule } from "../platform-jobs/platform-jobs.module";
import { UploadsModule } from "../uploads/uploads.module";
import { BackgroundRemovalService } from "./background-removal.service";
import { MediaAssetService } from "./media-asset.service";
import { MediaJobHandlers } from "./media-job.handlers";
import { MediaPipelineService } from "./media-pipeline.service";
import { MediaProcessingService } from "./media-processing.service";
import { MediaProcessorRegistry } from "./media-processor.registry";
import { MediaStorageGateway } from "./media-storage.gateway";
import { MediaController } from "./media.controller";
import { BACKGROUND_REMOVAL_PROVIDER, createBackgroundRemovalProvider } from "./providers/background-removal.provider";

/**
 * AI Media Processing Pipeline. Owns processing; templates consume outputs. All
 * execution is delegated to the Platform Job System — nothing AI runs in an HTTP
 * request. The background-removal provider is selected by configuration.
 */
@Module({
  imports: [TypeOrmModule.forFeature([MediaAsset, MediaDerivative, AnalyticsEvent]), UploadsModule, PlatformJobsModule],
  controllers: [MediaController],
  providers: [
    MediaProcessorRegistry,
    MediaStorageGateway,
    MediaAssetService,
    BackgroundRemovalService,
    MediaPipelineService,
    MediaProcessingService,
    MediaJobHandlers,
    { provide: BACKGROUND_REMOVAL_PROVIDER, useFactory: (config: ConfigService) => createBackgroundRemovalProvider(config), inject: [ConfigService] },
  ],
  exports: [MediaProcessingService, MediaAssetService],
})
export class MediaProcessingModule {}
