import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

/**
 * Processing lifecycle for a media asset, tracked SEPARATELY from the upload
 * lifecycle. An asset is always "uploaded" (the original exists and is never
 * overwritten); processingStatus reflects the AI pipeline's progress.
 */
export type MediaProcessingStatus =
  | "uploaded"
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "retry_required"
  | "cancelled";

/**
 * A source image uploaded by a user. The original is immutable; all AI outputs
 * are stored as separate MediaDerivative rows. This is the reusable unit the AI
 * Media Processing Pipeline operates on — background removal today, enhancement /
 * relighting / thumbnails tomorrow — without templates ever touching a provider.
 */
@Entity("media_assets")
@Index(["ownerUserId", "createdAt"])
@Index(["checksum"])
@Index(["processingStatus"])
export class MediaAsset {
  @PrimaryGeneratedColumn("uuid") id!: string;

  @Column({ type: "uuid", nullable: true }) ownerUserId?: string | null;

  /** Storage key + absolute URL of the ORIGINAL upload (never overwritten). */
  @Column({ type: "varchar" }) originalKey!: string;
  @Column({ type: "varchar" }) originalUrl!: string;

  @Column({ type: "varchar" }) mimeType!: string;
  @Column({ type: "int", nullable: true }) width?: number | null;
  @Column({ type: "int", nullable: true }) height?: number | null;
  @Column({ type: "bigint", nullable: true }) bytes?: number | null;

  /** Content checksum (sha256 hex) — the cache key for "process once" reuse. */
  @Column({ type: "varchar" }) checksum!: string;

  @Column({ type: "varchar", default: "uploaded" }) processingStatus!: MediaProcessingStatus;
  @Column({ type: "int", default: 0 }) retryCount!: number;
  @Column({ type: "varchar", nullable: true }) lastError?: string | null;
  @Column({ type: "timestamptz", nullable: true }) processingStartedAt?: Date | null;
  @Column({ type: "timestamptz", nullable: true }) processingCompletedAt?: Date | null;

  @CreateDateColumn({ type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ type: "timestamptz" }) updatedAt!: Date;
}
