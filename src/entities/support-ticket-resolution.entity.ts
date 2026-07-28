import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

@Entity("support_ticket_resolutions")
@Index(["ticketId", "createdAt"])
export class SupportTicketResolution {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ type: "uuid" }) ticketId!: string;
  @Column({ type: "varchar" }) action!: "resolved" | "reopened";
  @Column({ type: "varchar", nullable: true }) category?: string | null;
  @Column({ type: "text" }) summary!: string;
  @Column({ type: "uuid", nullable: true }) actorAdminUserId?: string | null;
  @Column({ type: "varchar", nullable: true }) actorAdminEmail?: string | null;
  @CreateDateColumn({ type: "timestamptz" }) createdAt!: Date;
}
