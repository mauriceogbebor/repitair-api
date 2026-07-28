import {
  Column,
  CreateDateColumn,
  Entity,
  JoinTable,
  ManyToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from "typeorm";
import { AdminRole } from "./admin-role.entity";

export type AdminUserStatus = "active" | "locked" | "suspended" | "pending_invitation" | "inactive" | "disabled";

@Entity("admin_users")
@Unique(["email"])
export class AdminUser {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  fullName!: string;

  @Column()
  email!: string;

  @Column({ select: false })
  passwordHash!: string;

  @Column({ default: "active" })
  status!: AdminUserStatus;

  @Column({ default: false })
  mfaEnabled!: boolean;

  @Column({ type: "varchar", nullable: true, select: false })
  mfaSecret?: string | null;

  @Column({ type: "int", default: 0 })
  failedLoginAttempts!: number;

  @Column({ type: "timestamptz", nullable: true })
  lockedUntil?: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  lastLoginAt?: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  lastActivityAt?: Date | null;

  @Column({ type: "varchar", nullable: true })
  lastLoginIp?: string | null;

  @Column({ type: "timestamptz", nullable: true })
  mfaEnrolledAt?: Date | null;

  @Column({ default: false })
  mfaResetRequired!: boolean;

  @Column({ type: "timestamptz", nullable: true })
  suspendedAt?: Date | null;

  @Column({ type: "text", nullable: true })
  suspensionReason?: string | null;

  @Column({ type: "timestamptz", nullable: true })
  inactiveAt?: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  accessReviewDueAt?: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  lastAccessReviewedAt?: Date | null;

  @ManyToMany(() => AdminRole, { eager: true })
  @JoinTable({
    name: "admin_user_roles",
    joinColumn: { name: "adminUserId", referencedColumnName: "id" },
    inverseJoinColumn: { name: "roleId", referencedColumnName: "id" },
  })
  roles!: AdminRole[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
