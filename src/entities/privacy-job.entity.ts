import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

export type PrivacyJobType =
  | "account_deletion"
  | "data_export"
  | "storage_cleanup"
  | "notification";

export type PrivacyJobStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "retry_required"
  | "cancelled";

/**
 * A privacy job = the EXECUTION of (part of) a request. One request can produce
 * several jobs (e.g. export generation, storage cleanup, notification). Jobs
 * carry their own retry/result state, so retries never mutate the original
 * request — the request records intent, the job records what actually happened.
 */
@Entity("privacy_jobs")
@Index(["requestId", "type"])
@Index(["status", "createdAt"])
export class PrivacyJob {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  requestId!: string;

  @Column({ type: "varchar" })
  type!: PrivacyJobType;

  @Column({ type: "varchar", default: "pending" })
  status!: PrivacyJobStatus;

  @Column({ type: "int", default: 0 })
  attempts!: number;

  @Column({ type: "timestamptz", nullable: true })
  startedAt?: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  finishedAt?: Date | null;

  @Column({ type: "int", nullable: true })
  durationMs?: number | null;

  /**
   * Structured execution result. For deletion: { outcome, deletedRecords,
   * deletedFiles, steps:[{name,status,...}], failureReason }. For export:
   * { outcome, packageSummary, package, generatedAt }. Download credentials and
   * lifecycle timestamps live in dedicated, indexed columns and are never
   * returned through ordinary Admin responses.
   */
  @Column({ type: "jsonb", nullable: true })
  result?: Record<string, unknown> | null;

  @Column({ type: "char", length: 64, nullable: true, select: false })
  downloadTokenHash?: string | null;

  @Column({ type: "timestamptz", nullable: true })
  downloadExpiresAt?: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  downloadedAt?: Date | null;

  @Column({ type: "text", nullable: true })
  lastError?: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
