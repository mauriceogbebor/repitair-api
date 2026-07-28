import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

export type SupportResponseStatus = "queued" | "sent_to_provider" | "failed" | "delivery_unknown";

@Entity("support_ticket_responses")
@Index(["ticketId", "createdAt"])
@Index(["idempotencyKey"], { unique: true })
export class SupportTicketResponse {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ type: "uuid" }) ticketId!: string;
  @Column({ type: "uuid", nullable: true }) authorAdminUserId?: string | null;
  @Column({ type: "varchar", nullable: true }) authorAdminEmail?: string | null;
  @Column({ type: "text" }) body!: string;
  @Column({ type: "varchar", default: "queued" }) status!: SupportResponseStatus;
  @Column({ type: "varchar", nullable: true }) failureCategory?: "provider_failure" | "migration_duplicate_uncertain" | null;
  @Column({ type: "varchar" }) idempotencyKey!: string;
  @Column({ type: "timestamptz", nullable: true }) sentAt?: Date | null;
  /** When the attempt was last claimed for a provider call (create or retry).
   *  Staleness is measured from this, NOT the immutable createdAt, so an active
   *  retry of an old attempt is not misclassified as stale. */
  @Column({ type: "timestamptz", nullable: true }) lastAttemptAt?: Date | null;
  @CreateDateColumn({ type: "timestamptz" }) createdAt!: Date;
}
