import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

/**
 * Platform job status — the EXECUTION lifecycle only. It deliberately does not
 * borrow domain statuses (fulfilled/approved/delivered); the originating domain
 * remains the source of business truth and applies the verified result itself.
 */
export type PlatformJobStatus =
  | "created"
  | "queued"
  | "scheduled"
  | "running"
  | "retry_scheduled"
  | "completed"
  | "failed"
  | "dead_lettered"
  | "cancelled"
  | "paused";

export type PlatformJobPriority = "low" | "normal" | "high" | "critical";

@Entity("platform_jobs")
@Index(["status", "queue", "scheduledFor"])
@Index(["type", "status"])
@Index(["idempotencyKey"], { unique: true, where: `"idempotencyKey" IS NOT NULL` })
@Index(["correlationId"])
export class PlatformJob {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar" })
  queue!: string;

  @Column({ type: "varchar" })
  type!: string;

  @Column({ type: "varchar" })
  domain!: string;

  @Column({ type: "jsonb", nullable: true })
  payload?: Record<string, unknown> | null;

  @Column({ type: "int", default: 1 })
  payloadVersion!: number;

  @Column({ type: "varchar", default: "queued" })
  status!: PlatformJobStatus;

  @Column({ type: "varchar", default: "normal" })
  priority!: PlatformJobPriority;

  @Column({ type: "varchar", nullable: true })
  idempotencyKey?: string | null;

  @Column({ type: "varchar", nullable: true })
  correlationId?: string | null;

  @Column({ type: "uuid", nullable: true })
  parentJobId?: string | null;

  @Column({ type: "varchar", nullable: true })
  createdBy?: string | null;

  @Column({ type: "timestamptz", nullable: true })
  scheduledFor?: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  queuedAt?: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  startedAt?: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  completedAt?: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  failedAt?: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  cancelledAt?: Date | null;

  @Column({ type: "int", default: 0 })
  attempts!: number;

  @Column({ type: "int", default: 5 })
  maxAttempts!: number;

  @Column({ type: "timestamptz", nullable: true })
  nextRetryAt?: Date | null;

  @Column({ type: "varchar", nullable: true })
  lastErrorCode?: string | null;

  @Column({ type: "text", nullable: true })
  lastErrorMessage?: string | null;

  @Column({ type: "text", nullable: true })
  lastErrorStack?: string | null;

  @Column({ type: "jsonb", nullable: true })
  result?: Record<string, unknown> | null;

  @Column({ type: "int", nullable: true })
  progress?: number | null;

  @Column({ type: "varchar", nullable: true })
  workerId?: string | null;

  @Column({ type: "timestamptz", nullable: true })
  lockedAt?: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  heartbeatAt?: Date | null;

  @Column({ type: "int", nullable: true })
  durationMs?: number | null;

  @Column({ type: "jsonb", nullable: true })
  metadata?: Record<string, unknown> | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
