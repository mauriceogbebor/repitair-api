import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PlatformJobsService } from "../platform-jobs/platform-jobs.service";
import { NonRetryableJobError } from "../platform-jobs/platform-job.types";
import { MediaAssetService } from "./media-asset.service";
import { MediaPipelineService } from "./media-pipeline.service";
import { MEDIA_BACKGROUND_REMOVE_JOB } from "./media-processing.service";
import { ProviderRequestError, ProviderTimeoutError } from "./providers/background-removal.provider";

/**
 * Registers the media domain's background-removal handler with the shared
 * Platform Job System. AI processing runs ONLY here (in the worker), never in an
 * HTTP request. The handler validates the asset is genuinely `queued` before
 * running (worker status guard), so a stale/duplicate job cannot reprocess.
 */
@Injectable()
export class MediaJobHandlers implements OnModuleInit {
  private readonly logger = new Logger(MediaJobHandlers.name);

  constructor(
    private readonly platformJobs: PlatformJobsService,
    private readonly assetService: MediaAssetService,
    private readonly pipeline: MediaPipelineService,
  ) {}

  onModuleInit() {
    this.platformJobs.registerHandler(MEDIA_BACKGROUND_REMOVE_JOB, async (ctx) => {
      const assetId = String(ctx.payload.assetId);
      const asset = await this.assetService.requireAsset(assetId);
      if (asset.processingStatus !== "queued") {
        throw new NonRetryableJobError(`Asset is not queued (status: ${asset.processingStatus}) — stale or duplicate job`, "stale_job");
      }

      await this.assetService.setStatus(assetId, "processing", { processingStartedAt: new Date() });
      await this.assetService.emit("media.processing_started", { assetId });
      await ctx.reportProgress(20, "removing background");
      try {
        const derivatives = await this.pipeline.run(asset);
        await this.assetService.setStatus(assetId, "completed", { processingCompletedAt: new Date(), lastError: null });
        await this.assetService.emit("media.processing_completed", { assetId, derivativeIds: derivatives.map((d) => d.id) });
        await ctx.reportProgress(100, "completed");
        return { assetId, derivativeIds: derivatives.map((d) => d.id) };
      } catch (error) {
        const message = error instanceof Error ? error.message : "processing failed";
        await this.assetService.setStatus(assetId, "failed", { lastError: message }).catch(() => undefined);
        // Classify provider outcomes so operators can tell an unhealthy provider
        // (timeout / rate-limit) apart from a genuine per-image failure.
        if (error instanceof ProviderTimeoutError) {
          await this.assetService.emit("media.provider_timeout", { assetId, error: message });
        } else if (error instanceof ProviderRequestError) {
          await this.assetService.emit("media.provider_error", { assetId, status: error.status, rateLimited: error.status === 429, error: message });
        }
        // The asset-level failure is always recorded (drives user + admin state).
        // The asset lands in `failed`; recovery is an explicit user/admin retry
        // (enqueueProcessing re-arms failed → retry_required → queued), so we do
        // NOT auto-retry against a paid provider from inside the worker guard.
        await this.assetService.emit("media.failed", { assetId, error: message });
        this.logger.warn(`Background removal failed for asset ${assetId}: ${message}`);
        throw new NonRetryableJobError(`Background removal failed: ${message}`, "processing_failed");
      }
    });
  }
}
