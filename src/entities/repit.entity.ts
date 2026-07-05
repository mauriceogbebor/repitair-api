import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from "typeorm";
import { User } from "./user.entity";
import { Template } from "./template.entity";
import type { CompositionCanvasMeta, RepitComposition } from "../common/composition/composition.types";

type RepitSongSelection = {
  songLink?: string | null;
  songTitle: string;
  artistName: string;
  platform: "spotify" | "apple-music";
  durationMs?: number | null;
  albumArtUrl?: string | null;
};

type RepitWidgetTransform = {
  x: number;
  y: number;
  scale: number;
  rotation: number;
};

type RepitEditorState = {
  aspectRatio?: "9:16" | "4:5" | "1:1";
  lyrics?: string;
  showDate?: boolean;
  showTime?: boolean;
  showDay?: boolean;
  customDate?: string | null;
  customTime?: string | null;
  compositionEffects?: Record<string, unknown> | null;
  playerTransform?: RepitWidgetTransform | null;
  dateTimeTransform?: RepitWidgetTransform | null;
  lyricsTransform?: RepitWidgetTransform | null;
};

@Entity("repits")
export class Repit {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  userId!: string;

  @ManyToOne(() => User, (user) => user.repits, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user!: User;

  @Column({ default: "Untitled Repitair" })
  title!: string;

  @Column({ type: "varchar", nullable: true })
  artist?: string | null;

  @Column({ default: "draft" })
  status!: string;

  @Column({ default: "spotify" })
  platform!: string;

  @Column()
  @Index()
  templateId!: string;

  @ManyToOne(() => Template, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "templateId" })
  template!: Template;

  @Column({ default: "" })
  songLink!: string;

  @Column({ type: "varchar", nullable: true })
  albumArt?: string | null;

  @Column({ type: "int", nullable: true })
  durationMs?: number | null;

  @Column({ type: "varchar", nullable: true })
  backgroundPhotoUrl?: string | null;

  @Column({ type: "jsonb", nullable: true })
  selectedSongs?: RepitSongSelection[] | null;

  @Column({ type: "jsonb", nullable: true })
  widgetTransforms?: RepitWidgetTransform[] | null;

  @Column({ type: "jsonb", nullable: true })
  editorState?: RepitEditorState | null;

  @Column({ type: "int", default: 1 })
  templateVersion!: number;

  @Column({ type: "jsonb", nullable: true })
  canvasMeta?: CompositionCanvasMeta | null;

  @Column({ type: "jsonb", nullable: true })
  composition?: RepitComposition | null;

  @Column({ default: "active" })
  moderationStatus!: string;

  @Column({ nullable: true })
  flagReason?: string | null;

  @Column({ type: "timestamptz", nullable: true })
  archivedAt?: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  deletedByAdminAt?: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
