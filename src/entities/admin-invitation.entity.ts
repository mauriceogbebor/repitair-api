import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

export type AdminInvitationStatus = "pending" | "enrolling_mfa" | "accepted" | "revoked" | "expired";

@Entity("admin_invitations")
@Index(["tokenHash"], { unique: true })
@Index(["adminUserId", "status"])
export class AdminInvitation {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column("uuid")
  adminUserId!: string;

  @Column({ type: "varchar" })
  tokenHash!: string;

  @Column({ type: "varchar", default: "pending" })
  status!: AdminInvitationStatus;

  @Column("uuid")
  invitedByAdminUserId!: string;

  @Column({ type: "timestamptz" })
  expiresAt!: Date;

  @Column({ type: "timestamptz", nullable: true })
  acceptedAt?: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  revokedAt?: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
