import { Entity, Index, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";

export type SpotlightTag = "NEW_SINGLE" | "NEW_ALBUM" | "TRENDING";
export type SpotlightStatus = "draft" | "scheduled" | "active" | "paused" | "expired" | "archived";

@Entity("spotlights")
export class Spotlight {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  title!: string;

  @Column({ type: "varchar", nullable: true })
  subtitle?: string | null;

  @Column()
  artist!: string;

  @Column({ type: "varchar", nullable: true })
  song?: string | null;

  @Column({ type: "varchar", nullable: true })
  songLink?: string | null;

  @Column()
  albumArt!: string;

  @Column({ type: "varchar", nullable: true })
  backgroundImage?: string | null;

  @Column({ default: "editorial" })
  campaignType!: string;

  @Column({ type: "varchar", nullable: true })
  buttonLabel?: string | null;

  @Column({ default: "NEW_SINGLE" })
  tag!: SpotlightTag;

  @Column({ type: "varchar", nullable: true })
  deepLink?: string | null;

  @Column({ type: "int", default: 0 })
  priority!: number;

  @Index()
  @Column({ default: "draft" })
  status!: SpotlightStatus;

  @Column({ type: "int", default: 0 })
  impressionCount!: number;

  @Column({ type: "int", default: 0 })
  tapCount!: number;

  @Column({ type: "timestamptz", nullable: true })
  startsAt?: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  expiresAt?: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  scheduledAt?: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  publishedAt?: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  archivedAt?: Date | null;

  @Column({ type: "varchar", nullable: true })
  submitterEmail?: string | null;

  @Column({ type: "uuid", nullable: true })
  createdByAdminUserId?: string | null;

  @Column({ type: "varchar", nullable: true })
  createdByAdminEmail?: string | null;

  @Column({ type: "uuid", nullable: true })
  updatedByAdminUserId?: string | null;

  @Column({ type: "varchar", nullable: true })
  updatedByAdminEmail?: string | null;

  @Column({ type: "uuid", nullable: true })
  duplicateOfSpotlightId?: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
