import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity("support_ticket_notes")
export class SupportTicketNote {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  ticketId!: string;

  @Column({ type: "uuid", nullable: true })
  authorAdminUserId?: string | null;

  @Column({ type: "varchar", nullable: true })
  authorAdminEmail?: string | null;

  @Column("text")
  body!: string;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
