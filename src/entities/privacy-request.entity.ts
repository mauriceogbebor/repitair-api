import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

export type PrivacyRequestType = "data_access" | "data_export" | "data_correction" | "account_deletion" | "other";

/**
 * Full privacy request lifecycle. The happy path is a strict progression;
 * exceptional states branch off it. Transitions are enforced by
 * PrivacyWorkflowService — a status is never set directly.
 */
export type PrivacyRequestStatus =
  | "pending"
  | "assigned"
  | "in_review"
  | "approved"
  | "processing"
  | "fulfilled"
  | "completed"
  // exceptional
  | "rejected"
  | "failed"
  | "retry_required"
  | "cancelled"
  | "expired";

export type PrivacyPriority = "low" | "medium" | "high" | "critical";
export type VerificationStatus = "unverified" | "verified" | "failed";

export interface AssignmentHistoryEntry {
  at: string;
  fromEmail?: string | null;
  toEmail: string;
  byEmail?: string | null;
}

/**
 * A privacy request = WHAT the user asked for. Execution of that request lives
 * in privacy_jobs (see PrivacyJob). A request only reaches "completed" after a
 * fulfilment record exists and its verification passes.
 */
@Entity("privacy_requests")
@Index(["status", "type", "createdAt"])
@Index(["assignedAdminEmail", "status"])
export class PrivacyRequest {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  userId!: string;

  @Column({ type: "varchar", nullable: true })
  userEmail?: string | null;

  @Column({ type: "varchar" })
  type!: PrivacyRequestType;

  @Column({ type: "varchar", default: "pending" })
  status!: PrivacyRequestStatus;

  @Column({ type: "varchar", default: "medium" })
  priority!: PrivacyPriority;

  // ── Assignment ───────────────────────────────────────────────────────────
  @Column({ type: "varchar", nullable: true })
  assignedAdminEmail?: string | null;

  @Column({ type: "timestamptz", nullable: true })
  assignedAt?: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  reassignedAt?: Date | null;

  @Column({ type: "jsonb", nullable: true })
  assignmentHistory?: AssignmentHistoryEntry[] | null;

  // ── SLA ──────────────────────────────────────────────────────────────────
  @Column({ type: "timestamptz", nullable: true })
  dueAt?: Date | null;

  @Column({ type: "int", default: 0 })
  escalationLevel!: number;

  // ── Fulfilment evidence (required before completion) ─────────────────────
  @Column({ type: "varchar", nullable: true })
  fulfilledByAdminEmail?: string | null;

  @Column({ type: "timestamptz", nullable: true })
  fulfilledAt?: Date | null;

  @Column({ type: "varchar", nullable: true })
  fulfilmentMethod?: string | null;

  @Column({ type: "varchar", nullable: true })
  fulfilmentResult?: string | null;

  @Column({ type: "varchar", default: "unverified" })
  verificationStatus!: VerificationStatus;

  @Column({ type: "text", nullable: true })
  internalNotes?: string | null;

  // ── Failure recovery ─────────────────────────────────────────────────────
  @Column({ type: "int", default: 0 })
  retryCount!: number;

  @Column({ type: "timestamptz", nullable: true })
  lastRetryAt?: Date | null;

  @Column({ type: "text", nullable: true })
  lastError?: string | null;

  @Column({ type: "text", nullable: true })
  rejectedReason?: string | null;

  @Column({ type: "text", nullable: true })
  notes?: string | null;

  @Column({ type: "timestamptz", nullable: true })
  completedAt?: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
