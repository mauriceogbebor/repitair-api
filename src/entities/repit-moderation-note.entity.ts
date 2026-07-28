import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

@Entity("repit_moderation_notes")
@Index(["repitId", "createdAt"])
export class RepitModerationNote {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  repitId!: string;

  @Column({ type: "uuid", nullable: true })
  reportId?: string | null;

  @Column({ type: "uuid", nullable: true })
  authorAdminUserId?: string | null;

  @Column({ type: "varchar", nullable: true })
  authorAdminEmail?: string | null;

  @Column({ type: "text" })
  body!: string;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
