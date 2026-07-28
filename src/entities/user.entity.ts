import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany } from "typeorm";
import { Repit } from "./repit.entity";
import { PushToken } from "./push-token.entity";

@Entity("users")
export class User {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  fullName!: string;

  @Column({ unique: true })
  email!: string;

  @Column({ default: "" })
  country!: string;

  @Column()
  passwordHash!: string;

  // Native Postgres text[] instead of simple-array so individual platform
  // strings can contain commas, and values remain queryable.
  @Column("text", { array: true, default: () => "'{}'" })
  connectedPlatforms!: string[];

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: "varchar", nullable: true })
  avatarUrl?: string;

  @Column({ type: "varchar", nullable: true })
  resetCode?: string;

  @Column({ type: "timestamp", nullable: true })
  resetCodeExpiresAt?: Date;

  /** Opaque token issued after successful code verification; required to reset the password. */
  @Column({ type: "varchar", nullable: true })
  resetToken?: string;

  @Column({ type: "timestamp", nullable: true })
  resetTokenExpiresAt?: Date;

  /** Number of failed reset-code verification attempts. Invalidates the code after 5. */
  @Column({ type: "int", default: 0 })
  resetCodeAttempts!: number;

  @OneToMany(() => Repit, (repit) => repit.user)
  repits!: Repit[];

  @OneToMany(() => PushToken, (token) => token.user)
  pushTokens!: PushToken[];

  /** Whether the user has verified their email address */
  @Column({ default: false })
  emailVerified!: boolean;

  @Column({ type: "varchar", nullable: true })
  emailVerifyCode?: string;

  @Column({ type: "timestamp", nullable: true })
  emailVerifyCodeExpiresAt?: Date;

  @Column({ type: "varchar", nullable: true, select: false })
  spotifyRefreshToken?: string;

  @Column({ type: "varchar", nullable: true, select: false })
  appleMusicUserToken?: string;

  @Column({ default: false })
  isSuspended!: boolean;

  @Column({ type: "varchar", nullable: true })
  suspensionReason?: string | null;

  @Column({ type: "timestamptz", nullable: true })
  suspendedAt?: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  lastLoginAt?: Date | null;

  @Column({ type: "varchar", nullable: true })
  signupSource?: string | null;

  /** Incrementing this invalidates every previously issued consumer access and refresh token. */
  @Column({ type: "int", default: 0 })
  sessionVersion!: number;
}
