import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

@Entity("template_drafts")
export class TemplateDraft {
  @PrimaryColumn()
  templateId!: string;

  @Column({ type: "int" })
  basedOnVersion!: number;

  @Column({ type: "int", default: 1 })
  revision!: number;

  @Column({ type: "jsonb" })
  snapshot!: Record<string, unknown>;

  @Column({ type: "uuid", nullable: true })
  authorAdminUserId?: string | null;

  @Column({ type: "varchar", nullable: true })
  authorEmail?: string | null;

  @Column({ type: "text", nullable: true })
  summary?: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
