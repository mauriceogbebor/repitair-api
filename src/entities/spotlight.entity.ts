import { Entity, Index, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";

export type SpotlightTag = "NEW_SINGLE" | "NEW_ALBUM" | "TRENDING";
export type SpotlightStatus = "pending" | "active" | "paused" | "expired";

@Entity("spotlights")
export class Spotlight {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /** Song / track title */
  @Column()
  title!: string;

  /** Artist or label name */
  @Column()
  artist!: string;

  /** Album art image URL */
  @Column()
  albumArt!: string;

  /** Promotional tag shown on the card */
  @Column({ default: "NEW_SINGLE" })
  tag!: SpotlightTag;

  /** Optional deep link when user taps the card (e.g. "/song/xyz") */
  @Column({ nullable: true })
  deepLink?: string;

  /** Higher priority = shown first. Used for queue ordering / paid tiers. */
  @Column({ type: "int", default: 0 })
  priority!: number;

  /** Campaign status */
  @Index()
  @Column({ default: "pending" })
  status!: SpotlightStatus;

  /** Total impressions served */
  @Column({ type: "int", default: 0 })
  impressionCount!: number;

  /** When the campaign goes live */
  @Column({ type: "timestamptz", nullable: true })
  startsAt?: Date;

  /** When the campaign expires */
  @Column({ type: "timestamptz", nullable: true })
  expiresAt?: Date;

  /** Contact email for the artist/label who submitted this */
  @Column({ nullable: true })
  submitterEmail?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
