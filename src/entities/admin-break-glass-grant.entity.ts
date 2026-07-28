import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

export type AdminBreakGlassStatus = "active" | "expired" | "revoked";

@Entity("admin_break_glass_grants")
@Index(["adminUserId", "status", "expiresAt"])
export class AdminBreakGlassGrant {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column("uuid")
  adminUserId!: string;

  @Column("uuid")
  activatedByAdminUserId!: string;

  @Column({ type: "uuid", nullable: true })
  approvedByAdminUserId?: string | null;

  @Column({ type: "text" })
  reason!: string;

  @Column({ type: "varchar", default: "active" })
  status!: AdminBreakGlassStatus;

  @Column({ type: "timestamptz" })
  expiresAt!: Date;

  @Column({ type: "timestamptz", nullable: true })
  revokedAt?: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
