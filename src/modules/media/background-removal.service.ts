import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { MediaAsset } from "../../entities/media-asset.entity";
import { MediaDerivative } from "../../entities/media-derivative.entity";
import { MediaAssetService } from "./media-asset.service";
import { MediaStorageGateway } from "./media-storage.gateway";
import { MediaProcessor } from "./media-processor.registry";
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
  readonly stage = "background_removal";
  readonly produces = "transparent_png" as const;
  readonly order = 10;

  constructor(
    @Inject(BACKGROUND_REMOVAL_PROVIDER) private readonly provider: BackgroundRemovalProvider,
    private readonly assetService: MediaAssetService,
    private readonly storage: MediaStorageGateway,
  ) {}

  /** Effective version token = provider model version + pipeline version. */
  private get versionKey(): string {
    return `${this.provider.version}+pl${MEDIA_PIPELINE_VERSION}`;
  }

  async process(asset: MediaAsset): Promise<MediaDerivative> {
    const versionKey = this.versionKey;

    const reusable = await this.assetService.findReusableDerivative(asset.id, "transparent_png", versionKey);
    if (reusable) {
      await this.assetService.emit("media.cache_hit", {
        assetId: asset.id, kind: "transparent_png", provider: this.provider.name,
        providerVersion: this.provider.version, pipelineVersion: MEDIA_PIPELINE_VERSION,
      });
      return reusable;
    }

    const source = await this.storage.readBytes(asset.originalUrl);
    const startedAt = Date.now();
    const output = await this.provider.removeBackground({ buffer: source, mimeType: asset.mimeType });
    const stored = await this.storage.storeDerivative(output.buffer, "image/png");
    const durationMs = Date.now() - startedAt;

    const derivative = await this.assetService.saveDerivative({
      assetId: asset.id,
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
    return derivative;
  }
}
