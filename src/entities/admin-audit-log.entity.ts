import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity("admin_audit_logs")
export class AdminAuditLog {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid", nullable: true })
  actorAdminUserId?: string | null;

  @Column({ type: "varchar", nullable: true })
  actorEmail?: string | null;

  @Column()
  action!: string;

  @Column({ type: "varchar", nullable: true })
  targetType?: string | null;

  @Column({ type: "varchar", nullable: true })
  targetId?: string | null;

  @Column({ type: "varchar", nullable: true })
  requestId?: string | null;

  @Column({ type: "varchar", nullable: true })
  method?: string | null;

  @Column({ type: "varchar", nullable: true })
  path?: string | null;

  @Column({ type: "varchar", nullable: true })
  ipAddress?: string | null;

  @Column({ type: "text", nullable: true })
  userAgent?: string | null;

  @Column({ type: "jsonb", nullable: true })
  beforeState?: Record<string, unknown> | null;

  @Column({ type: "jsonb", nullable: true })
  afterState?: Record<string, unknown> | null;

  @Column({ type: "jsonb", nullable: true })
  metadata?: Record<string, unknown> | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
