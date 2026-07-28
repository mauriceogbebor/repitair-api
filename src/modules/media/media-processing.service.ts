import { ConflictException, ForbiddenException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { MediaAsset } from "../../entities/media-asset.entity";
import { PlatformJobsService } from "../platform-jobs/platform-jobs.service";
import { MediaAssetService, RegisterAssetInput } from "./media-asset.service";
import { isReprocessable } from "./media-lifecycle";

export const MEDIA_BACKGROUND_REMOVE_JOB = "media.background_remove";

/**
 * Public entry point for the media pipeline. Enqueuing NEVER runs AI work in the
 * HTTP request — it transitions the asset to `queued` and hands execution to the
 * Platform Job System. The mobile contract is deliberately implementation-free.
 */
@Injectable()
export class MediaProcessingService {
  constructor(
    private readonly assetService: MediaAssetService,
    private readonly platformJobs: PlatformJobsService,
    @InjectRepository(MediaAsset) private readonly assets: Repository<MediaAsset>,
  ) {}

  /** Ownership guard for consumer routes — an asset is only visible to its owner. */
  async assertOwnership(assetId: string, userId: string) {
    const asset = await this.assetService.requireAsset(assetId);
    if (asset.ownerUserId && asset.ownerUserId !== userId) throw new ForbiddenException("You do not have access to this media asset");
    return asset;
  }

  async register(input: RegisterAssetInput) {
    const asset = await this.assetService.registerFromUpload(input);
    return this.status(asset.id);
  }

  /** Move the asset to `queued` and enqueue the background-removal job. */
  async enqueueProcessing(assetId: string) {
    const asset = await this.assetService.requireAsset(assetId);
    if (!isReprocessable(asset.processingStatus)) {
      if (asset.processingStatus === "completed") return this.status(assetId);
      throw new ConflictException(`Media is ${asset.processingStatus} and cannot be (re)queued`);
    }
    // uploaded → queued, or failed → retry_required → queued.
    if (asset.processingStatus === "failed") await this.assetService.setStatus(assetId, "retry_required");
    await this.assetService.setStatus(assetId, "queued", { lastError: null, processingStartedAt: null });

    const current = await this.assetService.requireAsset(assetId);
    try {
      await this.platformJobs.enqueue({
        type: MEDIA_BACKGROUND_REMOVE_JOB,
        payload: { assetId },
        idempotencyKey: `${MEDIA_BACKGROUND_REMOVE_JOB}:${assetId}:${current.retryCount}`,
        metadata: { assetId },
      });
    } catch {
      await this.assets.update({ id: assetId }, { processingStatus: "failed", lastError: "Failed to enqueue processing job" });
      throw new ServiceUnavailableException("Media processing is temporarily unavailable — the asset was not queued and can be retried.");
    }
    return this.status(assetId);
  }

  async retry(assetId: string) {
    await this.assets.increment({ id: assetId }, "retryCount", 1);
    await this.assetService.emit("media.retry", { assetId });
    return this.enqueueProcessing(assetId);
  }

  /**
   * Explicit regeneration (admin). Re-queues even a completed asset; the pipeline
   * reuses the derivative when the provider version is unchanged, and produces a
   * fresh one when it has been bumped — never destroying the prior output.
   */
  async regenerate(assetId: string) {
    const asset = await this.assetService.requireAsset(assetId);
    if (asset.processingStatus === "processing" || asset.processingStatus === "queued") {
      throw new ConflictException("Media is already being processed");
    }
    // Forced re-queue (bypasses the normal terminal-state guard) for regeneration.
    await this.assets.update({ id: assetId }, { processingStatus: "queued", lastError: null, processingStartedAt: null });
    const current = await this.assetService.requireAsset(assetId);
    try {
      await this.platformJobs.enqueue({
        type: MEDIA_BACKGROUND_REMOVE_JOB,
        payload: { assetId },
        idempotencyKey: `${MEDIA_BACKGROUND_REMOVE_JOB}:regen:${assetId}:${current.retryCount}:${Date.now()}`,
        metadata: { assetId, regenerate: true },
      });
    } catch {
      await this.assets.update({ id: assetId }, { processingStatus: "failed", lastError: "Failed to enqueue regeneration job" });
      throw new ServiceUnavailableException("Media processing is temporarily unavailable — regeneration was not queued.");
    }
    await this.assetService.emit("media.regenerated", { assetId });
    return this.status(assetId);
  }

  /**
   * Template-facing image resolution. The backend — never the template or the
   * mobile client — decides which image a template renders:
   *  - a template that does NOT require isolation always uses the original;
   *  - a template that DOES require isolation uses the transparent derivative when
   *    it is ready, and otherwise auto-starts processing and reports `pending`.
   * It NEVER silently substitutes the original for a template that requires
   * isolation, and never reports `ready` while the AI step is unfinished.
   */
  async resolveTemplateImage(assetId: string, requiresBackgroundRemoval: boolean, options: { autoStart?: boolean } = {}) {
    const asset = await this.assetService.requireAsset(assetId);
    if (!requiresBackgroundRemoval) {
      return { assetId, image: asset.originalUrl, source: "original" as const, ready: true, processingStatus: asset.processingStatus, error: null };
    }

    const transparent = await this.assetService.findDerivative(asset.id, "transparent_png");
    if (asset.processingStatus === "completed" && transparent) {
      return { assetId, image: transparent.url, source: "derivative" as const, ready: true, processingStatus: asset.processingStatus, error: null };
    }

    // Required but not ready: auto-start when idle, and report pending — never the original.
    if ((options.autoStart ?? true) && isReprocessable(asset.processingStatus)) {
      await this.enqueueProcessing(assetId).catch(() => undefined);
    }
    const refreshed = await this.assetService.requireAsset(assetId);
    return { assetId, image: null, source: "pending" as const, ready: false, processingStatus: refreshed.processingStatus, error: refreshed.lastError ?? null };
  }

  /**
   * Mobile / template-facing contract. The backend decides which asset a template
   * uses: the transparent derivative when ready, else the original.
   */
  async status(assetId: string) {
    const asset = await this.assetService.requireAsset(assetId);
    const transparent = await this.assetService.findDerivative(asset.id, "transparent_png");
    return {
      assetId: asset.id,
      originalImage: asset.originalUrl,
      processedImage: transparent?.url ?? null,
      processingStatus: asset.processingStatus,
      error: asset.lastError ?? null,
    };
  }

  async detail(assetId: string) {
    const asset = await this.assetService.requireAsset(assetId);
    const derivatives = await this.assetService.listDerivatives(asset.id);
    return {
      id: asset.id,
      ownerUserId: asset.ownerUserId ?? null,
      originalUrl: asset.originalUrl,
      mimeType: asset.mimeType,
      checksum: asset.checksum,
      processingStatus: asset.processingStatus,
      retryCount: asset.retryCount,
      lastError: asset.lastError ?? null,
      processingStartedAt: asset.processingStartedAt ?? null,
      processingCompletedAt: asset.processingCompletedAt ?? null,
      derivatives: derivatives.map((d) => ({
        id: d.id, kind: d.kind, url: d.url, provider: d.provider, providerVersion: d.providerVersion,
        processorVersion: d.processorVersion, pipelineVersion: d.pipelineVersion,
        providerRequestId: d.providerRequestId ?? null, checksum: d.checksum ?? null,
        bytes: d.bytes != null ? Number(d.bytes) : null, width: d.width ?? null, height: d.height ?? null,
        processingDurationMs: d.processingDurationMs ?? null, createdAt: d.createdAt,
      })),
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt,
    };
  }
}
