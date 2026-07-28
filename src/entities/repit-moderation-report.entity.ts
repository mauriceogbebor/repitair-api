import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

export type ModerationReportPriority = "low" | "medium" | "high" | "critical";
export type ModerationReportStatus = "open" | "under_review" | "escalated" | "resolved";
export type ModerationReporterType = "consumer" | "admin" | "support" | "system";

@Entity("repit_moderation_reports")
@Index(["status", "priority", "createdAt"])
@Index(["repitId", "status"])
@Index("UQ_repit_moderation_reports_active", ["repitId"], { unique: true, where: `"status" IN ('open', 'under_review', 'escalated')` })
export class RepitModerationReport {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  repitId!: string;

  @Column({ type: "uuid", nullable: true })
  reporterUserId?: string | null;

  @Column({ type: "varchar" })
  reporterType!: ModerationReporterType;

  @Column({ type: "varchar" })
  reportType!: string;

  @Column({ type: "varchar", default: "medium" })
  priority!: ModerationReportPriority;

  @Column({ type: "varchar", default: "open" })
  status!: ModerationReportStatus;

  @Column({ type: "text" })
  reason!: string;

  @Column({ type: "text", nullable: true })
  reporterComment?: string | null;

  @Column({ type: "jsonb", nullable: true })
  evidence?: Record<string, unknown> | null;

  @Column({ type: "uuid", nullable: true })
  assignedAdminUserId?: string | null;

  @Column({ type: "varchar", nullable: true })
  assignedAdminEmail?: string | null;

  @Column({ type: "varchar", nullable: true })
  escalationTarget?: "support" | "compliance" | null;

  @Column({ type: "timestamptz", nullable: true })
  claimedAt?: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  resolvedAt?: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
