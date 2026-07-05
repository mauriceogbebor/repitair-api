import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";
import type { CompositionCanvasMeta, TemplateComposition } from "../common/composition/composition.types";
import type {
  TemplateCapabilities,
  TemplateDesignTokens,
  TemplateConstraints,
  TemplateDesignerNotes,
  TemplateWorkflowConfig,
  TemplateCertificationMeta,
} from "../common/template-metadata/template-metadata.types";

export type TemplateAdminStatus = "draft" | "published" | "archived";

@Entity("templates")
export class Template {
  @PrimaryColumn()
  id!: string;

  @Column()
  name!: string;

  @Column()
  style!: string;

  @Column({ default: "All" })
  category!: string;

  @Column({ default: false })
  premium!: boolean;

  @Column({ default: false })
  animated!: boolean;

  @Column({ type: "int", default: 0 })
  sortOrder!: number;

  @Column({ default: "draft" })
  status!: TemplateAdminStatus;

  @Column({ default: true })
  isActive!: boolean;

  /** Layout variant hint for client rendering (e.g. "classic", "neon", "bold") */
  @Column({ default: "classic" })
  layoutVariant!: string;

  /** Player widget variant hint (e.g. "default", "playlist", "scatteredCards") */
  @Column({ default: "default" })
  playerVariant!: string;

  /** Suggested overlay opacity for the photo layer (0–1) */
  @Column({ type: "real", default: 0.3 })
  overlayOpacity!: number;

  @Column({ type: "int", default: 1 })
  templateVersion!: number;

  @Column({ type: "jsonb", nullable: true })
  canvasMeta?: CompositionCanvasMeta | null;

  @Column({ type: "jsonb", nullable: true })
  composition?: TemplateComposition | null;

  @Column({ type: "jsonb", nullable: true })
  previewImages?: string[] | null;

  /* ── Template-First Metadata (Sprint D) ─────────────────────────── */

  /** Template capabilities — what content types and features this template supports. */
  @Column({ type: "jsonb", nullable: true })
  capabilities?: TemplateCapabilities | null;

  /** Design tokens — colour/spacing metadata describing the template's visual identity. */
  @Column({ type: "jsonb", nullable: true })
  designTokens?: TemplateDesignTokens | null;

  /** Constraints — creative boundaries and recommendations for this template. */
  @Column({ type: "jsonb", nullable: true })
  constraints?: TemplateConstraints | null;

  /** Designer notes — internal creative intent, mood, and guidance. Never exposed to users. */
  @Column({ type: "jsonb", nullable: true })
  designerNotes?: TemplateDesignerNotes | null;

  /** Workflow configuration — authored content-first editing journey. */
  @Column({ type: "jsonb", nullable: true })
  workflow?: TemplateWorkflowConfig | null;

  /** Certification metadata — publishing pipeline status. */
  @Column({ type: "jsonb", nullable: true })
  certificationMeta?: TemplateCertificationMeta | null;

  @Column({ nullable: true })
  createdByAdminUserId?: string | null;

  @Column({ nullable: true })
  createdByAdminEmail?: string | null;

  @Column({ nullable: true })
  updatedByAdminUserId?: string | null;

  @Column({ nullable: true })
  updatedByAdminEmail?: string | null;

  @Column({ nullable: true })
  lastChangeSummary?: string | null;

  @Column({ type: "timestamptz", nullable: true })
  publishedAt?: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  archivedAt?: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
