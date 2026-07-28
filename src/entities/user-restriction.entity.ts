import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

export type UserRestrictionType = "account_suspension";
export type UserRestrictionStatus = "active" | "revoked";

@Entity("user_restrictions")
export class UserRestriction {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  userId!: string;

  @Column({ type: "varchar" })
  type!: UserRestrictionType;

  @Column({ type: "varchar", default: "active" })
  status!: UserRestrictionStatus;

  @Column({ type: "varchar", nullable: true })
  policyCategory?: string | null;

  @Column({ type: "text" })
  reason!: string;

  @Column({ type: "timestamptz" })
  startsAt!: Date;

  @Column({ type: "uuid", nullable: true })
  issuedByAdminUserId?: string | null;

  @Column({ type: "varchar", nullable: true })
  issuedByAdminEmail?: string | null;

  @Column({ type: "timestamptz", nullable: true })
  revokedAt?: Date | null;

  @Column({ type: "uuid", nullable: true })
  revokedByAdminUserId?: string | null;

  @Column({ type: "varchar", nullable: true })
  revokedByAdminEmail?: string | null;

  @Column({ type: "text", nullable: true })
  revocationReason?: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
