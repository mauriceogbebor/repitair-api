import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

export type SupportTicketStatus =
  | "new"
  | "open"
  | "assigned"
  | "waiting_for_customer"
  | "resolved"
  | "closed";

export type SupportTicketPriority = "low" | "medium" | "high" | "critical";

@Entity("contact_submissions")
export class ContactSubmission {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  name!: string;

  @Column()
  email!: string;

  @Column()
  subject!: string;

  @Column("text")
  message!: string;

  @Column({ default: false })
  emailSent!: boolean;

  @Column({ default: "new" })
  status!: SupportTicketStatus;

  @Column({ default: "medium" })
  priority!: SupportTicketPriority;

  @Column({ nullable: true })
  category?: string | null;

  @Column("text", { array: true, default: () => "'{}'" })
  tags!: string[];

  @Column({ nullable: true })
  assignedAdminUserId?: string | null;

  @Column({ nullable: true })
  assignedAdminEmail?: string | null;

  @Column({ nullable: true })
  relatedUserId?: string | null;

  @Column("text", { array: true, default: () => "'{}'" })
  relatedRepitIds!: string[];

  @Column("text", { array: true, default: () => "'{}'" })
  relatedNotificationIds!: string[];

  @Column({ type: "timestamptz", nullable: true })
  firstResponseDueAt?: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  resolutionDueAt?: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  resolvedAt?: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  closedAt?: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  lastCustomerReplyAt?: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  lastAdminReplyAt?: Date | null;

  @Column({ default: "contact_form" })
  source!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
