import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { MediaAsset } from "../../entities/media-asset.entity";
import { MediaDerivative } from "../../entities/media-derivative.entity";
import type { PlatformJob } from "../../entities/platform-job.entity";
import { Template } from "../../entities/template.entity";
import { Repit } from "../../entities/repit.entity";
import { PlatformJobsService } from "../platform-jobs/platform-jobs.service";
import { MediaAssetService, RegisterAssetInput } from "./media-asset.service";
import { canTransitionMedia, isReprocessable } from "./media-lifecycle";
import { MediaStorageGateway } from "./media-storage.gateway";
import { BackgroundRemovalService } from "./background-removal.service";
import { isolationCapabilityError, templateRequiresBackgroundRemoval } from "./template-media-capability";
import { normalizeMediaProcessingPurpose, purposeRequiresBackgroundRemoval, type MediaProcessingPurpose } from "./media-processing-purpose";

export const MEDIA_BACKGROUND_REMOVE_JOB = "media.background_remove";
export const REQUIRED_ISOLATION_SAVE_MESSAGE =
  "This template requires a completed isolated-subject image before the Repit can be saved.";
const MEDIA_QUEUE_DELAYED_MS = Number(process.env.MEDIA_QUEUE_DELAYED_MS) || 120_000;

export type RequiredIsolationBinding = {
  assetId: string;
  derivativeUrl: string;
};

type RequiredIsolationSaveInput = {
  userId: string;
  template: Template;
  editorState?: Record<string, unknown> | null;
  composition?: Repit["composition"] | null;
  backgroundPhotoUrl?: string | null;
};

/**
 * Extract the server-owned storage key from a client-facing image URL. Works for
 * both local URLs (`/api/uploads/<key>`) and S3 URLs — signed or unsigned —
 * (`https://bucket.s3.region.amazonaws.com/<key>?X-Amz-...`). Comparing by key
 * is signing-tolerant: the same object yields the same key regardless of the
 * short-lived query params on a presigned URL.
 */
export function storageKeyFromUri(uri: string | null | undefined): string | null {
  if (!uri || typeof uri !== "string") return null;
  try {
    const parsed = new URL(uri);
    const uploadsPrefix = "/api/uploads/";
    if (parsed.pathname.startsWith(uploadsPrefix)) {
      return decodeURIComponent(parsed.pathname.slice(uploadsPrefix.length));
    }
    return decodeURIComponent(parsed.pathname.replace(/^\/+/, "")) || null;
  } catch {
    return null;
  }
}

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
    @InjectRepository(Template) private readonly templates: Repository<Template>,
    @InjectRepository(Repit) private readonly repits: Repository<Repit>,
    private readonly storage: MediaStorageGateway,
    private readonly backgroundRemoval: BackgroundRemovalService,
    private readonly dataSource: DataSource,
  ) {}

  /** Ownership guard for consumer routes — an asset is only visible to its owner. */
  async assertOwnership(assetId: string, userId: string) {
    const asset = await this.assetService.requireAsset(assetId);
    if (!asset.ownerUserId || asset.ownerUserId !== userId) {
      throw new ForbiddenException("You do not have access to this media asset");
    }
    return asset;
  }

  async register(input: RegisterAssetInput) {
    const asset = await this.assetService.registerFromUpload(input);
    return this.status(asset.id);
  }

  private jobState(
    processingStatus: MediaAsset["processingStatus"],
    job: PlatformJob | null,
    knownJobId?: string | null,
  ) {
    const jobId = knownJobId ?? job?.id ?? null;
    const jobStatus = job?.status
      ?? (jobId && processingStatus === "queued" ? "queued" : null);
    const queuedAt = job?.queuedAt ?? job?.createdAt ?? null;
    const queueDelayed = (
      processingStatus === "queued"
      && jobStatus === "queued"
      && queuedAt != null
      && Date.now() - new Date(queuedAt).getTime() >= MEDIA_QUEUE_DELAYED_MS
    );
    return {
      jobId,
      jobStatus,
      queuedAt,
      queueDelayed,
      queueDelayThresholdMs: MEDIA_QUEUE_DELAYED_MS,
    };
  }

  async linkRepit(assetId: string, repitId: string, templateId: string, userId: string) {
    const repit = await this.repits.findOne({ where: { id: repitId, userId, templateId } });
    if (!repit) throw new NotFoundException("Repit not found");
    if (repit.editorState?.mediaAssetId !== assetId) {
      throw new ConflictException("Repit media does not match this asset");
    }
    const job = await this.platformJobs.attachMediaCorrelation(assetId, { repitId, templateId });
    await this.assetService.emit("media.repit_linked", {
      assetId,
      templateId,
      repitId,
      jobId: job?.id ?? null,
    });
    return { linked: true, assetId, templateId, repitId, jobId: job?.id ?? null };
  }

  /**
   * Server-side save boundary for required-isolation templates. A client URI or
   * capability boolean is never sufficient: ownership, lifecycle, compatible
   * provenance, storage availability, and canonical composition use must agree.
   */
  async assertRequiredIsolationReady(
    input: RequiredIsolationSaveInput,
  ): Promise<RequiredIsolationBinding | null> {
    if (!templateRequiresBackgroundRemoval(input.template.capabilities)) return null;
    if (isolationCapabilityError(input.template.capabilities)) {
      throw new ConflictException("Template isolation capability is inconsistent");
    }

    const assetId = typeof input.editorState?.mediaAssetId === "string"
      ? input.editorState.mediaAssetId.trim()
      : "";
    if (!assetId) throw new BadRequestException(REQUIRED_ISOLATION_SAVE_MESSAGE);

    const asset = await this.assertOwnership(assetId, input.userId);
    if (asset.processingStatus !== "completed") {
      throw new BadRequestException(REQUIRED_ISOLATION_SAVE_MESSAGE);
    }

    const derivative = await this.assetService.findReusableDerivative(
      asset.id,
      "transparent_png",
      this.backgroundRemoval.compatibilityVersion,
    );
    if (!derivative || derivative.mimeType.toLowerCase() !== "image/png") {
      throw new BadRequestException(REQUIRED_ISOLATION_SAVE_MESSAGE);
    }
    if (!(await this.storage.objectExists(derivative.key))) {
      throw new BadRequestException(REQUIRED_ISOLATION_SAVE_MESSAGE);
    }

    const processedPhotoUri = typeof input.editorState?.processedPhotoUri === "string"
      ? input.editorState.processedPhotoUri
      : null;
    const photoLayer = input.composition?.layers.find((layer) => layer.type === "photo");
    const compositionPhotoUri = typeof photoLayer?.data?.uri === "string"
      ? photoLayer.data.uri
      : null;
    // Match by storage KEY, not by URL string. Client-facing URLs are now
    // short-lived signed URLs (same object key, rotating query params), so a
    // string compare against the stored derivative URL would never match.
    const matchesDerivative = (uri: string | null | undefined) =>
      storageKeyFromUri(uri) === derivative.key;
    if (
      !matchesDerivative(processedPhotoUri)
      || !matchesDerivative(input.backgroundPhotoUrl)
      || !matchesDerivative(compositionPhotoUri)
    ) {
      throw new BadRequestException(REQUIRED_ISOLATION_SAVE_MESSAGE);
    }

    return { assetId: asset.id, derivativeUrl: await this.storage.signedReadUrl(derivative.key) };
  }

  /**
   * Atomically transition the asset to `queued` AND enqueue the job in ONE
   * database transaction (P1-01). The asset row is locked (pessimistic write) so
   * concurrent process requests serialise; the status change and the job insert
   * commit together, so there is never a queued asset without a job or a job
   * without a queued asset. Any failure rolls the whole thing back.
   */
  async enqueueProcessing(
    assetId: string,
    options: { templateId?: string; incrementRetry?: boolean } = {},
  ) {
    let jobId: string | null = null;
    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(MediaAsset);
      const asset = await repo.findOne({ where: { id: assetId }, lock: { mode: "pessimistic_write" } });
      if (!asset) throw new ConflictException("Media asset not found");

      if (!isReprocessable(asset.processingStatus)) {
        // Completed → nothing to do (idempotent). Anything else in-flight → conflict.
        if (asset.processingStatus === "completed") return;
        throw new ConflictException(`Media is ${asset.processingStatus} and cannot be (re)queued`);
      }

      // uploaded → queued, or failed → retry_required → queued (validated transitions).
      if (asset.processingStatus === "failed") {
        if (!canTransitionMedia(asset.processingStatus, "retry_required")) throw new ConflictException("Illegal media transition");
        asset.processingStatus = "retry_required";
      }
      if (!canTransitionMedia(asset.processingStatus, "queued")) throw new ConflictException(`Cannot queue media from ${asset.processingStatus}`);
      if (options.incrementRetry) asset.retryCount += 1;
      asset.processingStatus = "queued";
      asset.lastError = null;
      asset.processingStartedAt = null;
      await repo.save(asset);

      // Durable handoff inside the same transaction — rollback removes both.
      const job = await this.platformJobs.enqueueWithManager(manager, {
        type: MEDIA_BACKGROUND_REMOVE_JOB,
        payload: { assetId },
        idempotencyKey: `${MEDIA_BACKGROUND_REMOVE_JOB}:${assetId}:${asset.retryCount}`,
        correlationId: options.templateId ? `template:${options.templateId}:asset:${assetId}` : `asset:${assetId}`,
        metadata: { assetId, templateId: options.templateId ?? null },
      });
      jobId = job.id;
    }).catch((err) => {
      if (err instanceof ConflictException) throw err;
      throw new ServiceUnavailableException("Media processing is temporarily unavailable — the asset was not queued and can be retried.");
    });
    return { ...(await this.status(assetId)), jobId };
  }

  async retry(assetId: string) {
    const result = await this.enqueueProcessing(assetId, { incrementRetry: true });
    await this.assetService.emit("media.retry", { assetId, jobId: result.jobId });
    return result;
  }

  /**
   * Explicit regeneration (admin). Re-queues even a completed asset; the pipeline
   * reuses the derivative when the provider version is unchanged, and produces a
   * fresh one when it has been bumped — never destroying the prior output.
   */
  async regenerate(assetId: string) {
    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(MediaAsset);
      const asset = await repo.findOne({ where: { id: assetId }, lock: { mode: "pessimistic_write" } });
      if (!asset) throw new ConflictException("Media asset not found");
      if (asset.processingStatus === "processing" || asset.processingStatus === "queued") {
        throw new ConflictException("Media is already being processed");
      }
      // Forced re-queue (bypasses the terminal-state guard) for regeneration.
      asset.processingStatus = "queued";
      asset.lastError = null;
      asset.processingStartedAt = null;
      await repo.save(asset);
      await this.platformJobs.enqueueWithManager(manager, {
        type: MEDIA_BACKGROUND_REMOVE_JOB,
        payload: { assetId },
        idempotencyKey: `${MEDIA_BACKGROUND_REMOVE_JOB}:regen:${assetId}:${asset.retryCount}:${Date.now()}`,
        metadata: { assetId, regenerate: true },
      });
    }).catch((err) => {
      if (err instanceof ConflictException) throw err;
      throw new ServiceUnavailableException("Media processing is temporarily unavailable — regeneration was not queued.");
    });
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
  async resolveTemplateImage(
    assetId: string,
    templateId: string,
    options: { autoStart?: boolean; retryFailed?: boolean; purpose?: MediaProcessingPurpose } = {},
  ) {
    const purpose = normalizeMediaProcessingPurpose(options.purpose);
    const template = await this.templates.findOne({
      where: { id: templateId, status: "published", isActive: true },
    });
    if (!template) throw new NotFoundException("Published template not found");

    // The template capability governs the DEFAULT (canvasSubject) purpose. An
    // intrinsic isolation purpose (e.g. the Ice Girl widget subject) forces
    // removal on its owning template even when that template's own background is
    // a full photo requiring none — otherwise the widget-subject job is never
    // enqueued and the subject is never isolated. This only ever ADDS a job for
    // the one template that owns the purpose; every other template/flow is
    // unaffected.
    const requiresBackgroundRemoval =
      templateRequiresBackgroundRemoval(template.capabilities)
      || purposeRequiresBackgroundRemoval(purpose, templateId);
    const asset = await this.assetService.requireAsset(assetId);
    if (!requiresBackgroundRemoval) {
      const response = {
        status: "ready" as const,
        requiresBackgroundRemoval: false,
        imageSource: "original" as const,
        imageUrl: await this.storage.signedReadUrl(asset.originalKey),
        assetId,
        jobId: null,
        jobStatus: null,
        queuedAt: null,
        queueDelayed: false,
        queueDelayThresholdMs: MEDIA_QUEUE_DELAYED_MS,
        processingStatus: asset.processingStatus,
        statusUrl: `/media/assets/${assetId}`,
      };
      await this.assetService.emit("media.template_resolved", {
        assetId, templateId, purpose, requiresBackgroundRemoval: false, imageSource: "original", status: "ready",
      });
      return response;
    }

    let current = asset;
    let recoveredMissingDerivative = false;
    let transparent = await this.assetService.findReusableDerivative(
      asset.id,
      "transparent_png",
      this.backgroundRemoval.compatibilityVersion,
    );
    if (asset.processingStatus === "completed" && transparent) {
      const derivativeExists = await this.storage.objectExists(transparent.key);
      if (derivativeExists) {
        const latestJob = await this.platformJobs.findLatestForMediaAsset(assetId);
        const jobState = this.jobState(asset.processingStatus, latestJob);
        const response = {
          status: "ready" as const,
          requiresBackgroundRemoval: true,
          imageSource: "derivative" as const,
          imageUrl: await this.storage.signedReadUrl(transparent.key),
          assetId,
          ...jobState,
          processingStatus: asset.processingStatus,
          statusUrl: `/media/assets/${assetId}`,
          // Opt-in subject-fit inputs (Ice Girl). Null-safe for legacy derivatives.
          derivativeWidth: transparent.width ?? null,
          derivativeHeight: transparent.height ?? null,
          visibleBounds: transparent.visibleBounds ?? null,
        };
        await this.assetService.emit("media.template_resolved", {
          assetId, templateId, purpose, requiresBackgroundRemoval: true, imageSource: "derivative", status: "ready",
          jobId: response.jobId,
        });
        return response;
      }

      // A DB row without its object is not ready. Remove the stale provenance
      // row and move the asset into the ordinary retry path before re-queuing.
      await this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(MediaAsset);
        const locked = await repo.findOne({ where: { id: assetId }, lock: { mode: "pessimistic_write" } });
        if (!locked) throw new NotFoundException("Media asset not found");
        await manager.getRepository(MediaDerivative).delete({ id: transparent!.id, assetId });
        if (locked.processingStatus === "completed") {
          locked.processingStatus = "retry_required";
          locked.lastError = "Processed media is being regenerated";
          await repo.save(locked);
        }
      });
      transparent = null;
      current = await this.assetService.requireAsset(assetId);
      recoveredMissingDerivative = true;
    }

    // Preserve older outputs for provenance, but never treat an incompatible
    // provider/pipeline version as ready for a required-isolation template.
    if (asset.processingStatus === "completed" && !transparent && !recoveredMissingDerivative) {
      await this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(MediaAsset);
        const locked = await repo.findOne({ where: { id: assetId }, lock: { mode: "pessimistic_write" } });
        if (!locked) throw new NotFoundException("Media asset not found");
        if (locked.processingStatus === "completed") {
          locked.processingStatus = "retry_required";
          locked.lastError = "Processed media is being updated";
          await repo.save(locked);
        }
      });
      current = await this.assetService.requireAsset(assetId);
      recoveredMissingDerivative = true;
    }

    // Required but not ready: auto-start when idle, and report pending — never the original.
    let jobId: string | null = null;
    const canAutoStart = current.processingStatus === "uploaded"
      || recoveredMissingDerivative
      || (options.retryFailed === true && isReprocessable(current.processingStatus));
    if ((options.autoStart ?? true) && canAutoStart) {
      try {
        const queued = await this.enqueueProcessing(assetId, {
          templateId,
          incrementRetry: current.processingStatus !== "uploaded",
        });
        jobId = queued.jobId;
      } catch (error) {
        // Concurrent resolves serialize on the asset lock. If another request
        // already queued it, return that authoritative state instead of a 409.
        if (!(error instanceof ConflictException)) throw error;
      }
    }
    const refreshed = await this.assetService.requireAsset(assetId);
    const latestJob = await this.platformJobs.findLatestForMediaAsset(assetId);
    const jobState = this.jobState(refreshed.processingStatus, latestJob, jobId);
    const failed = ["failed", "retry_required", "cancelled"].includes(refreshed.processingStatus);
    const response = {
      status: failed ? "failed" as const : "processing" as const,
      requiresBackgroundRemoval: true,
      imageSource: "pending" as const,
      imageUrl: null,
      assetId,
      ...jobState,
      processingStatus: refreshed.processingStatus,
      statusUrl: `/media/assets/${assetId}`,
      errorCode: failed ? "SUBJECT_PREPARATION_FAILED" : null,
      retryable: refreshed.processingStatus !== "cancelled",
    };
    await this.assetService.emit("media.template_resolved", {
      assetId, templateId, purpose, requiresBackgroundRemoval: true, imageSource: "pending",
      status: response.status, processingStatus: refreshed.processingStatus, jobId: response.jobId,
    });
    return response;
  }

  /**
   * Mobile / template-facing contract. The backend decides which asset a template
   * uses: the transparent derivative when ready, else the original.
   */
  async status(assetId: string) {
    const asset = await this.assetService.requireAsset(assetId);
    const transparent = await this.assetService.findDerivative(asset.id, "transparent_png");
    const latestJob = await this.platformJobs.findLatestForMediaAsset(asset.id);
    // Return short-lived signed URLs the client can load directly — a bare S3
    // object URL 403s on a private bucket.
    const [originalImage, processedImage] = await Promise.all([
      this.storage.signedReadUrl(asset.originalKey),
      transparent ? this.storage.signedReadUrl(transparent.key) : Promise.resolve(null),
    ]);
    return {
      assetId: asset.id,
      originalImage,
      processedImage,
      processingStatus: asset.processingStatus,
      error: asset.lastError ?? null,
      ...this.jobState(asset.processingStatus, latestJob),
    };
  }

  async detail(assetId: string) {
    const asset = await this.assetService.requireAsset(assetId);
    const derivatives = await this.assetService.listDerivatives(asset.id);
    const latestJob = await this.platformJobs.findLatestForMediaAsset(asset.id);
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
      latestJob: latestJob ? {
        id: latestJob.id,
        status: latestJob.status,
        templateId: typeof latestJob.metadata?.templateId === "string" ? latestJob.metadata.templateId : null,
        repitId: typeof latestJob.metadata?.repitId === "string" ? latestJob.metadata.repitId : null,
        correlationId: latestJob.correlationId ?? null,
        attempts: latestJob.attempts,
        createdAt: latestJob.createdAt,
      } : null,
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
