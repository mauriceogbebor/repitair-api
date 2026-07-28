import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { createHash } from "node:crypto";
import { AnalyticsEvent } from "../../entities/analytics-event.entity";
import { MediaAsset, MediaProcessingStatus } from "../../entities/media-asset.entity";
import { MediaDerivative, MediaDerivativeKind } from "../../entities/media-derivative.entity";
import { canTransitionMedia } from "./media-lifecycle";
import { MediaStorageGateway } from "./media-storage.gateway";

const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_DIMENSION = 8000;

export interface RegisterAssetInput {
  ownerUserId?: string | null;
  originalKey: string;
  originalUrl: string;
  mimeType: string;
  width?: number | null;
  height?: number | null;
  bytes?: number | null;
}

@Injectable()
export class MediaAssetService {
  constructor(
    @InjectRepository(MediaAsset) private readonly assets: Repository<MediaAsset>,
    @InjectRepository(MediaDerivative) private readonly derivatives: Repository<MediaDerivative>,
    @InjectRepository(AnalyticsEvent) private readonly analytics: Repository<AnalyticsEvent>,
    private readonly storage: MediaStorageGateway,
  ) {}

  /** Reject malicious / unsupported uploads before they enter the pipeline. */
  static validateUpload(input: { mimeType: string; bytes?: number | null; width?: number | null; height?: number | null }): void {
    if (!ALLOWED_MIME.includes(input.mimeType)) throw new BadRequestException(`Unsupported image type. Allowed: ${ALLOWED_MIME.join(", ")}`);
    if (input.bytes != null && input.bytes > MAX_BYTES) throw new BadRequestException(`Image exceeds the ${MAX_BYTES / 1024 / 1024}MB limit`);
    if (input.width != null && input.width > MAX_DIMENSION) throw new BadRequestException("Image width exceeds the supported maximum");
    if (input.height != null && input.height > MAX_DIMENSION) throw new BadRequestException("Image height exceeds the supported maximum");
  }

  /**
   * Register an already-uploaded image as a processable asset. Reads the bytes
   * once (cheap, non-AI) to compute the checksum that powers "process once"
   * caching; the original is never modified.
   */
  async registerFromUpload(input: RegisterAssetInput): Promise<MediaAsset> {
    MediaAssetService.validateUpload(input);
    const bytes = await this.storage.readBytes(input.originalUrl);
    if (bytes.length > MAX_BYTES) throw new BadRequestException(`Image exceeds the ${MAX_BYTES / 1024 / 1024}MB limit`);
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const asset = await this.assets.save(this.assets.create({
      ownerUserId: input.ownerUserId ?? null,
      originalKey: input.originalKey,
      originalUrl: input.originalUrl,
      mimeType: input.mimeType,
      width: input.width ?? null,
      height: input.height ?? null,
      bytes: input.bytes ?? bytes.length,
      checksum,
      processingStatus: "uploaded",
    }));
    await this.emit("media.uploaded", { assetId: asset.id, mimeType: asset.mimeType, bytes: asset.bytes, checksum });
    return asset;
  }

  async requireAsset(id: string): Promise<MediaAsset> {
    const asset = await this.assets.findOne({ where: { id } });
    if (!asset) throw new NotFoundException("Media asset not found");
    return asset;
  }

  /** Transition processing status with validation; rejects illegal transitions. */
  async setStatus(id: string, to: MediaProcessingStatus, patch: Partial<MediaAsset> = {}): Promise<MediaAsset> {
    const asset = await this.requireAsset(id);
    if (asset.processingStatus === to) return asset;
    if (!canTransitionMedia(asset.processingStatus, to)) {
      throw new ConflictException(`Cannot move media from ${asset.processingStatus} to ${to}`);
    }
    Object.assign(asset, patch, { processingStatus: to });
    return this.assets.save(asset);
  }

  findDerivative(assetId: string, kind: MediaDerivativeKind): Promise<MediaDerivative | null> {
    return this.derivatives.findOne({ where: { assetId, kind }, order: { createdAt: "DESC" } });
  }

  /** Reuse an existing derivative only when the provider version matches. */
  async findReusableDerivative(assetId: string, kind: MediaDerivativeKind, providerVersion: string): Promise<MediaDerivative | null> {
    return this.derivatives.findOne({ where: { assetId, kind, providerVersion } });
  }

  saveDerivative(input: Partial<MediaDerivative>): Promise<MediaDerivative> {
    return this.derivatives.save(this.derivatives.create(input));
  }

  listDerivatives(assetId: string): Promise<MediaDerivative[]> {
    return this.derivatives.find({ where: { assetId }, order: { createdAt: "ASC" } });
  }

  async emit(name: string, properties: Record<string, unknown>): Promise<void> {
    await this.analytics
      .save(this.analytics.create({ name, source: "media", occurredAt: new Date(), properties }))
      .catch(() => undefined);
  }
}
