import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

/**
 * A single operational feature toggle. The flag KEY is the primary key so a flag
 * is created-or-updated idempotently. Flags gate Release-1 exposure of features
 * whose backend already exists (e.g. moderation) without deleting any code.
 */
@Entity("feature_flags")
export class FeatureFlag {
  @PrimaryColumn({ type: "varchar" })
  key!: string;

  @Column({ type: "boolean", default: false })
  enabled!: boolean;

  @Column({ type: "varchar", nullable: true })
  description?: string | null;

  @Column({ type: "varchar", nullable: true })
  updatedByAdminEmail?: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
