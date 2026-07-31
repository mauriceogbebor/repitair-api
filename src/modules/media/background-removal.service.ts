import { Inject, Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import { MediaAsset } from "../../entities/media-asset.entity";
import { MediaDerivative } from "../../entities/media-derivative.entity";
import { MediaAssetService } from "./media-asset.service";
import { MediaStorageGateway } from "./media-storage.gateway";
import { MediaProcessor, MediaProcessorContext } from "./media-processor.registry";
import { validateTransparentOutput } from "./media-image-validation";
import { BACKGROUND_REMOVAL_PROVIDER, BackgroundRemovalProvider } from "./providers/background-removal.provider";

/**
 * Version of the overall media pipeline. Bump this when a change to the pipeline
 * itself (edge cleanup, alpha refinement, shadow generation) should regenerate
 * derivatives even though the provider model is unchanged. It is folded into the
 * effective cache key so only outdated derivatives are invalidated — the prior
 * output row is preserved, never destroyed or blindly regenerated in bulk.
 */
export const MEDIA_PIPELINE_VERSION = 1;
const PROCESSOR_VERSION = 1;

/**
 * Background-removal pipeline stage. Owns the "process once" cache: if a
 * transparent PNG already exists for this asset AND the provider+pipeline version
 * is unchanged, it is reused with NO AI call. A version change produces a new
 * derivative (regeneration) without destroying the old one.
 */
@Injectable()
export class BackgroundRemovalService implements MediaProcessor {
  private readonly logger = new Logger(BackgroundRemovalService.name);
  readonly stage = "background_removal";
  readonly produces = "transparent_png" as const;
  readonly order = 10;

  constructor(
    @Inject(BACKGROUND_REMOVAL_PROVIDER) private readonly provider: BackgroundRemovalProvider,
    private readonly assetService: MediaAssetService,
    private readonly storage: MediaStorageGateway,
  ) {}

  /** Effective version token covers every compatibility input for this output. */
  get compatibilityVersion(): string {
    return `${this.provider.version}+pr${PROCESSOR_VERSION}+pl${MEDIA_PIPELINE_VERSION}+out-transparent_png`;
  }

  get providerName(): string {
    return this.provider.name;
  }

  async process(asset: MediaAsset, context?: MediaProcessorContext): Promise<MediaDerivative> {
    const versionKey = this.compatibilityVersion;

    // 1) Per-asset reuse (this asset already has a derivative at this version).
    const reusable = await this.assetService.findReusableDerivative(asset.id, "transparent_png", versionKey);
    if (reusable) {
      if (await this.storage.objectExists(reusable.key)) {
        await this.emitCacheHit(asset.id, "asset");
        return reusable;
      }
      await this.assetService.removeDerivative(reusable.id);
    }

    // 2) Content-addressed reuse: identical source bytes processed before (any
    //    asset/user) at this version — reuse the stored output, no provider call.
    if (asset.checksum) {
      const contentMatch = await this.assetService.findByContent(asset.checksum, "transparent_png", versionKey);
      if (contentMatch) {
        if (await this.storage.objectExists(contentMatch.key)) {
          const copy = await this.assetService.saveDerivative({
            assetId: asset.id,
            sourceChecksum: asset.checksum,
            kind: "transparent_png",
            key: contentMatch.key,
            url: contentMatch.url,
            mimeType: contentMatch.mimeType,
            width: contentMatch.width ?? null,
            height: contentMatch.height ?? null,
            bytes: contentMatch.bytes ?? null,
            checksum: contentMatch.checksum ?? null,
            provider: contentMatch.provider,
            providerVersion: versionKey,
            processorVersion: PROCESSOR_VERSION,
            pipelineVersion: MEDIA_PIPELINE_VERSION,
            providerRequestId: contentMatch.providerRequestId ?? null,
            processingDurationMs: 0,
          });
          await this.emitCacheHit(asset.id, "content");
          return copy;
        }
        await this.assetService.removeDerivative(contentMatch.id);
      }
    }

    // 3) Miss — call the provider, VALIDATE its output before persisting.
    const source = await this.storage.readByKey(asset.originalKey);
    const startedAt = Date.now();
    this.logger.log(
      `[WORKER] provider request started jobId=${context?.jobId ?? "unknown"}`
      + ` assetId=${asset.id} provider=${this.provider.name}`,
    );
    const output = await this.provider.removeBackground({ buffer: source, mimeType: asset.mimeType });
    validateTransparentOutput(output.buffer);
    const stored = await this.storage.storeDerivative(output.buffer, "image/png");
    const durationMs = Date.now() - startedAt;

    const derivative = await this.assetService.saveDerivative({
      assetId: asset.id,
      sourceChecksum: asset.checksum ?? null,
      kind: "transparent_png",
      key: stored.key,
      url: stored.url,
      mimeType: "image/png",
      width: output.width ?? null,
      height: output.height ?? null,
      bytes: output.buffer.length,
      checksum: createHash("sha256").update(output.buffer).digest("hex"),
      provider: this.provider.name,
      providerVersion: versionKey,
      processorVersion: PROCESSOR_VERSION,
      pipelineVersion: MEDIA_PIPELINE_VERSION,
      providerRequestId: output.providerRequestId ?? null,
      processingDurationMs: durationMs,
    });

    await this.assetService.emit("media.processed", {
      assetId: asset.id, kind: "transparent_png", provider: this.provider.name,
      providerVersion: this.provider.version, pipelineVersion: MEDIA_PIPELINE_VERSION,
      durationMs, providerRequestId: output.providerRequestId ?? null,
      creditsCharged: output.creditsCharged ?? null,
    });
    this.logger.log(
      `[WORKER] provider request completed jobId=${context?.jobId ?? "unknown"}`
      + ` assetId=${asset.id} provider=${this.provider.name}`
      + ` providerRequestId=${output.providerRequestId ?? "unavailable"}`
      + ` durationMs=${durationMs}`,
    );
    return derivative;
  }

  private emitCacheHit(assetId: string, scope: "asset" | "content"): Promise<void> {
    return this.assetService.emit("media.cache_hit", {
      assetId, scope, kind: "transparent_png", provider: this.provider.name,
      providerVersion: this.provider.version, pipelineVersion: MEDIA_PIPELINE_VERSION,
    });
  }
}
