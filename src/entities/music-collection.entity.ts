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

import type { MusicProviderName } from "./music-connection.entity";
import { User } from "./user.entity";

export type MusicCollectionTrack = {
  provider: MusicProviderName;
  providerTrackId: string | null;
  title: string;
  artist: string;
  album: string | null;
  albumArt: string | null;
  durationMs: number | null;
  explicit: boolean | null;
  sourceLink: string;
};

@Entity("music_collections")
@Index(["shareCode"], { unique: true })
@Index(["ownerId", "createdAt"])
export class MusicCollection {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  ownerId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "ownerId" })
  owner!: User;

  @Column({ type: "varchar" })
  shareCode!: string;

  @Column({ type: "varchar" })
  name!: string;

  @Column({ type: "varchar" })
  sourceProvider!: MusicProviderName;

  @Column({ type: "varchar", nullable: true, select: false })
  sourcePlaylistId?: string | null;

  @Column({ type: "varchar", nullable: true })
  artworkUrl?: string | null;

  @Column({ type: "jsonb" })
  tracks!: MusicCollectionTrack[];

  @Column({ type: "int" })
  trackCount!: number;

  @Column({ type: "timestamptz", nullable: true })
  sourceSyncedAt?: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
