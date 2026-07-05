import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity("support_ticket_notes")
export class SupportTicketNote {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  ticketId!: string;

  @Column({ nullable: true })
  authorAdminUserId?: string | null;

  @Column({ nullable: true })
  authorAdminEmail?: string | null;

  @Column("text")
  body!: string;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
