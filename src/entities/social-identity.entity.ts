import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
  Index,
} from "typeorm";
import { User } from "./user.entity";

export type SocialAuthProvider = "apple" | "google";

/**
 * A durable link between a Repitair user and a social login provider identity.
 *
 * The **primary** key for identity resolution is `(provider, providerSubject)` —
 * the provider's stable subject (Apple/Google `sub`), NOT the email. Emails may
 * be hidden, relayed (Apple private relay), or absent on later logins, so they
 * must never be the sole identifier. A single user may own several rows (one per
 * provider), enabling email/password + Google + Apple on one account without
 * duplicates.
 */
@Entity("social_identities")
@Unique("UQ_social_identities_provider_subject", ["provider", "providerSubject"])
@Index("IDX_social_identities_user", ["userId"])
export class SocialIdentity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column("uuid")
  userId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user!: User;

  /** "apple" | "google" */
  @Column()
  provider!: SocialAuthProvider;

  /** The provider's stable subject identifier (id_token `sub`). */
  @Column()
  providerSubject!: string;

  /** The email the provider returned at authorization time (may be a relay). */
  @Column({ type: "varchar", nullable: true })
  providerEmail?: string | null;

  /** True when providerEmail is an Apple private-relay address. */
  @Column({ default: false })
  providerEmailIsPrivateRelay!: boolean;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @Column({ type: "timestamptz", nullable: true })
  lastAuthenticatedAt?: Date | null;
}
