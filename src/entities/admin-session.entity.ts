import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from "typeorm";

@Entity("admin_sessions")
@Index(["adminUserId", "revokedAt", "expiresAt"])
export class AdminSession {
  @PrimaryColumn("uuid")
  id!: string;

  @Column("uuid")
  adminUserId!: string;

  @Column({ type: "varchar", nullable: true })
  ipAddress?: string | null;

  @Column({ type: "text", nullable: true })
  userAgent?: string | null;

  @Column({ type: "varchar", nullable: true })
  browser?: string | null;

  @Column({ type: "varchar", nullable: true })
  operatingSystem?: string | null;

  @Column({ type: "varchar", nullable: true })
  approximateLocation?: string | null;

  @Column({ type: "timestamptz" })
  expiresAt!: Date;

  @Column({ type: "timestamptz", nullable: true })
  lastActivityAt?: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  revokedAt?: Date | null;

  @Column({ type: "uuid", nullable: true })
  revokedByAdminUserId?: string | null;

  @Column({ type: "text", nullable: true })
  revocationReason?: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
