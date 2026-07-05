import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

export type AdminNotificationStatus = "draft" | "scheduled" | "sent" | "cancelled" | "failed";

export type AdminNotificationType =
  | "push"
  | "in_app"
  | "announcement"
  | "marketing"
  | "system"
  | "information";

@Entity("notification_campaigns")
export class NotificationCampaign {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  title!: string;

  @Column("text")
  message!: string;

  @Column({ default: "all_users" })
  audience!: string;

  @Column({ type: "jsonb", nullable: true })
  audienceFilters?: Record<string, unknown> | null;

  @Column({ default: "push" })
  type!: AdminNotificationType;

  @Column({ type: "varchar", nullable: true })
  imageUrl?: string | null;

  @Column({ type: "varchar", nullable: true })
  deepLink?: string | null;

  @Column({ type: "varchar", nullable: true })
  ctaLabel?: string | null;

  @Column({ default: "draft" })
  status!: AdminNotificationStatus;

  @Column({ type: "timestamptz", nullable: true })
  scheduledAt?: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  sentAt?: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  cancelledAt?: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  failedAt?: Date | null;

  @Column({ type: "uuid", nullable: true })
  createdByAdminUserId?: string | null;

  @Column({ type: "varchar", nullable: true })
  createdByAdminEmail?: string | null;

  @Column({ type: "uuid", nullable: true })
  updatedByAdminUserId?: string | null;

  @Column({ type: "varchar", nullable: true })
  updatedByAdminEmail?: string | null;

  @Column({ type: "uuid", nullable: true })
  duplicateOfNotificationId?: string | null;

  @Column({ type: "int", default: 0 })
  recipientCount!: number;

  @Column({ type: "int", default: 0 })
  deliveredCount!: number;

  @Column({ type: "int", default: 0 })
  failedCount!: number;

  @Column({ type: "int", default: 0 })
  clickCount!: number;

  @Column({ type: "jsonb", nullable: true })
  deliverySummary?: Record<string, unknown> | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
