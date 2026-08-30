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

  /**
   * True once the user has an intentionally-set password (email signup, password
   * reset, or password change). Social-only accounts get a random unusable
   * password and remain false — email/password login is refused for them with a
   * "use your social provider" message instead of a misleading credential error.
   */
  @Column({ default: false })
  hasUsablePassword!: boolean;

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

  // --- Pending email-change workflow (Finding 2) --------------------------
  // The primary `email` is only replaced AFTER the user proves control of the
  // new address via a code sent to it. Until then the requested address lives
  // here, and only a HASH of the confirmation code is stored (never the raw
  // code) so a DB read leak cannot be replayed into an email takeover.

  /** The new address awaiting confirmation (normalized lower-case). */
  @Column({ type: "varchar", nullable: true })
  pendingEmail?: string | null;

  /** SHA-256 hash of the single-use confirmation code for `pendingEmail`. */
  @Column({ type: "varchar", nullable: true })
  pendingEmailCodeHash?: string | null;

  @Column({ type: "timestamp", nullable: true })
  pendingEmailExpiresAt?: Date | null;

  /** Failed confirmation attempts; the pending change is voided after 5. */
  @Column({ type: "int", default: 0 })
  pendingEmailAttempts!: number;

  /** When the current pending change was requested — powers the request cooldown. */
  @Column({ type: "timestamp", nullable: true })
  pendingEmailRequestedAt?: Date | null;
}
