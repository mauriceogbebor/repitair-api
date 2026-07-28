import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

export type UserRecoveryOperationType = "password_reset" | "verification_resend" | "sessions_revoked";

@Entity("user_recovery_operations")
export class UserRecoveryOperation {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  userId!: string;

  @Column({ type: "varchar" })
  type!: UserRecoveryOperationType;

  @Column({ type: "varchar" })
  status!: "completed" | "failed";

  @Column({ type: "text" })
  reason!: string;

  @Column({ type: "uuid", nullable: true })
  initiatedByAdminUserId?: string | null;

  @Column({ type: "varchar", nullable: true })
  initiatedByAdminEmail?: string | null;

  @Column({ type: "varchar", nullable: true })
  deliveryStatus?: "queued" | "failed" | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
