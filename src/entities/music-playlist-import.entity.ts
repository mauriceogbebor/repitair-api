import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

import type { MusicProviderName } from "./music-connection.entity";
import { User } from "./user.entity";

@Entity("music_playlist_imports")
@Index(["userId", "provider", "playlistId"], { unique: true })
@Index(["userId", "provider", "importedAt"])
export class MusicPlaylistImport {
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
  playlistId!: string;

  @Column({ type: "int" })
  trackCount!: number;

  @UpdateDateColumn({ type: "timestamptz" })
  importedAt!: Date;
}
