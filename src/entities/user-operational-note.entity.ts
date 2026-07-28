import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity("user_operational_notes")
export class UserOperationalNote {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  userId!: string;

  @Column({ type: "uuid", nullable: true })
  authorAdminUserId?: string | null;

  @Column({ type: "varchar", nullable: true })
  authorAdminEmail?: string | null;

  @Column({ type: "text" })
  body!: string;

  @Column({ type: "varchar", default: "internal" })
  visibility!: "internal";

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
