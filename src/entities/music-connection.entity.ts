import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

import { User } from "./user.entity";

export type MusicProviderName = "spotify" | "apple-music";
export type MusicConnectionStatus = "connected" | "reauth_required" | "disconnected";

@Entity("music_connections")
@Index(["userId", "provider"], { unique: true })
@Index(["status"])
export class MusicConnection {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  userId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user!: User;

  @Column({ type: "varchar" })
  provider!: MusicProviderName;

  @Column({ type: "varchar", default: "connected" })
  status!: MusicConnectionStatus;

  @Column({ type: "text", nullable: true, select: false })
  encryptedAccessToken?: string | null;

  @Column({ type: "text", nullable: true, select: false })
  encryptedRefreshToken?: string | null;

  @Column({ type: "timestamptz", nullable: true })
  accessTokenExpiresAt?: Date | null;

  @Column("text", { array: true, default: () => "'{}'" })
  scopes!: string[];

  @Column({ type: "varchar", nullable: true })
  providerUserId?: string | null;

  @Column({ type: "varchar", nullable: true })
  accountName?: string | null;

  @Column({ type: "int", nullable: true })
  playlistCount?: number | null;

  @Column({ type: "timestamptz", nullable: true })
  lastSyncedAt?: Date | null;

  @Column({ type: "varchar", nullable: true })
  lastErrorCode?: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
