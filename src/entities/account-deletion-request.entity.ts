import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

export type AccountDeletionStatus = "pending" | "in_progress" | "completed" | "rejected";

export interface DeletionAuditEntry {
  at: string;
  action: string;
  actorEmail?: string | null;
  note?: string | null;
}

/**
 * Operational queue for account-deletion fulfilment. A row is created when a
 * consumer deletes their account (or requests deletion) so operators have an
 * auditable record of the request and its handling.
 */
@Entity("account_deletion_requests")
@Index(["status", "createdAt"])
export class AccountDeletionRequest {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  userId!: string;

  @Column({ type: "varchar", nullable: true })
  userEmail?: string | null;

  @Column({ type: "varchar", default: "pending" })
  status!: AccountDeletionStatus;

  @Column({ type: "varchar", nullable: true })
  reason?: string | null;

  @Column({ type: "timestamptz", nullable: true })
  completedAt?: Date | null;

  @Column({ type: "varchar", nullable: true })
  handledByAdminEmail?: string | null;

  @Column({ type: "text", nullable: true })
  notes?: string | null;

  @Column({ type: "jsonb", nullable: true })
  auditHistory?: DeletionAuditEntry[] | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
