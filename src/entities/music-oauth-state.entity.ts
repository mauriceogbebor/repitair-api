import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";

import type { MusicProviderName } from "./music-connection.entity";
import { User } from "./user.entity";

@Entity("music_oauth_states")
@Index(["stateHash"], { unique: true })
@Index(["expiresAt"])
export class MusicOAuthState {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  userId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user!: User;

  @Column({ type: "varchar" })
  provider!: MusicProviderName;

  @Column({ type: "varchar" })
  stateHash!: string;

  @Column({ type: "text", nullable: true, select: false })
  encryptedCodeVerifier?: string | null;

  @Column({ type: "timestamptz" })
  expiresAt!: Date;

  @Column({ type: "timestamptz", nullable: true })
  consumedAt?: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
