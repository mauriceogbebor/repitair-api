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

export type AdminUserStatus = "active" | "locked" | "disabled";

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

  @Column({ nullable: true, select: false })
  mfaSecret?: string | null;

  @Column({ type: "int", default: 0 })
  failedLoginAttempts!: number;

  @Column({ type: "timestamptz", nullable: true })
  lockedUntil?: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  lastLoginAt?: Date | null;

  @Column({ type: "varchar", nullable: true })
  lastLoginIp?: string | null;

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
