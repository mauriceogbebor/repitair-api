import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

export type SupportEscalationDestination = "support_lead" | "operations" | "trust_safety" | "engineering_sre" | "security_compliance" | "content_operations";
export type SupportEscalationStatus = "open" | "accepted" | "resolved" | "returned";

@Entity("support_ticket_escalations")
@Index(["ticketId", "status"])
@Index(["destination", "status", "createdAt"])
export class SupportTicketEscalation {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ type: "uuid" }) ticketId!: string;
  @Column({ type: "varchar" }) destination!: SupportEscalationDestination;
  @Column({ type: "varchar" }) severity!: "low" | "medium" | "high" | "critical";
  @Column({ type: "text" }) reason!: string;
  @Column({ type: "text" }) requestedAction!: string;
  @Column({ type: "varchar", default: "open" }) status!: SupportEscalationStatus;
  @Column({ type: "uuid", nullable: true }) assignedAdminUserId?: string | null;
  @Column({ type: "varchar", nullable: true }) assignedAdminEmail?: string | null;
  @Column({ type: "text", nullable: true }) outcome?: string | null;
  @Column({ type: "uuid", nullable: true }) createdByAdminUserId?: string | null;
  @Column({ type: "varchar", nullable: true }) createdByAdminEmail?: string | null;
  @Column({ type: "timestamptz", nullable: true }) acceptedAt?: Date | null;
  @Column({ type: "timestamptz", nullable: true }) resolvedAt?: Date | null;
  @CreateDateColumn({ type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ type: "timestamptz" }) updatedAt!: Date;
}
