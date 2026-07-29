import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/**
 * A processed output produced from a MediaAsset by one pipeline stage. Kinds are
 * open-ended so future stages (enhancement, relighting, shadow, thumbnail) reuse
 * the same model. The current pipeline emits "transparent_png".
 */
export type MediaDerivativeKind =
  | "transparent_png"
  | "optimized_png"
  | "thumbnail"
  | "enhanced"
  | "relit"
  | "shadow";

/**
 * Derivative asset. One row per (asset, kind, providerVersion) — never
 * overwritten, so a provider-version bump can regenerate without destroying the
 * prior output, and templates consume a stable processed asset.
 */
@Entity("media_derivatives")
@Index(["assetId", "kind"])
@Index(["assetId", "kind", "providerVersion"], { unique: true })
export class MediaDerivative {
  @PrimaryGeneratedColumn("uuid") id!: string;

  @Column({ type: "uuid" }) assetId!: string;

  /**
   * sha256 of the SOURCE image this derivative was produced from. Combined with
   * the version key it makes the cache content-addressed: identical source bytes
   * processed at the same versions reuse the stored output with no new provider
   * call, even across different assets/users.
   */
  @Column({ type: "varchar", nullable: true }) @Index() sourceChecksum?: string | null;

  @Column({ type: "varchar" }) kind!: MediaDerivativeKind;

  @Column({ type: "varchar" }) key!: string;
  @Column({ type: "varchar" }) url!: string;
  @Column({ type: "varchar", default: "image/png" }) mimeType!: string;

  @Column({ type: "int", nullable: true }) width?: number | null;
  @Column({ type: "int", nullable: true }) height?: number | null;
  @Column({ type: "bigint", nullable: true }) bytes?: number | null;
  @Column({ type: "varchar", nullable: true }) checksum?: string | null;

  /** Provenance for regeneration + analytics. */
  @Column({ type: "varchar" }) provider!: string;
  @Column({ type: "varchar" }) providerVersion!: string;
  /** Version of the pipeline stage that produced this (bump to force regen). */
  @Column({ type: "int", default: 1 }) processorVersion!: number;
  /**
   * Version of the overall media pipeline that produced this derivative. Bumping
   * it lets a future edge-cleanup / alpha-refinement / shadow improvement
   * invalidate ONLY outdated derivatives instead of the entire media library.
   */
  @Column({ type: "int", default: 1 }) pipelineVersion!: number;
  /** Upstream provider request id (support + provenance), where available. */
  @Column({ type: "varchar", nullable: true }) providerRequestId?: string | null;
  @Column({ type: "int", nullable: true }) processingDurationMs?: number | null;

  @CreateDateColumn({ type: "timestamptz" }) createdAt!: Date;
}
