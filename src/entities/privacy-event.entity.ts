import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/**
 * Immutable timeline entry for a privacy request. One row is appended for every
 * meaningful transition (submitted, assigned, approved, export generated, link
 * created, downloaded, completed, failed, …) so the request has a complete,
 * chronological, auditable history that renders directly as the UI timeline.
 */
@Entity("privacy_events")
@Index(["requestId", "at"])
export class PrivacyEvent {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  requestId!: string;

  /** e.g. "submitted", "assigned", "approved", "export.generated", "completed". */
  @Column({ type: "varchar" })
  type!: string;

  @Column({ type: "varchar", nullable: true })
  message?: string | null;

  @Column({ type: "varchar", nullable: true })
  actorEmail?: string | null;

  @Column({ type: "jsonb", nullable: true })
  metadata?: Record<string, unknown> | null;

  @Column({ type: "timestamptz" })
  at!: Date;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
