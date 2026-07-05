import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

export type TemplateVersionAction = "created" | "updated" | "published" | "archived" | "rollback";

@Entity("template_versions")
export class TemplateVersion {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  templateId!: string;

  @Column({ type: "int" })
  versionNumber!: number;

  @Column({ default: false })
  published!: boolean;

  @Column({ default: "updated" })
  action!: TemplateVersionAction;

  @Column({ nullable: true })
  summary?: string | null;

  @Column({ type: "jsonb" })
  snapshot!: Record<string, unknown>;

  @Column({ nullable: true })
  authorAdminUserId?: string | null;

  @Column({ nullable: true })
  authorEmail?: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
