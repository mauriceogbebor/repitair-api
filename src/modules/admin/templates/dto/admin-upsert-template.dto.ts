import { IsArray, IsBoolean, IsNumber, IsObject, IsOptional, IsString, Max, Min } from "class-validator";
import type {
  TemplateCapabilities,
  TemplateDesignTokens,
  TemplateConstraints,
  TemplateDesignerNotes,
  TemplateWorkflowConfig,
  TemplateCertificationMeta,
} from "../../../../common/template-metadata/template-metadata.types";

export class AdminUpsertTemplateDto {
  @IsString()
  id!: string;

  @IsString()
  name!: string;

  @IsString()
  style!: string;

  @IsString()
  category!: string;

  @IsOptional()
  @IsBoolean()
  premium?: boolean;

  @IsOptional()
  @IsBoolean()
  animated?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;

  @IsOptional()
  @IsString()
  layoutVariant?: string;

  @IsOptional()
  @IsString()
  playerVariant?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  overlayOpacity?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  previewImages?: string[];

  @IsOptional()
  composition?: Record<string, unknown>;

  @IsOptional()
  canvasMeta?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  changeSummary?: string;

  /* ── Template-First Metadata (Sprint D) ─────────────────────── */

  @IsOptional()
  @IsObject()
  capabilities?: TemplateCapabilities;

  @IsOptional()
  @IsObject()
  designTokens?: TemplateDesignTokens;

  @IsOptional()
  @IsObject()
  constraints?: TemplateConstraints;

  @IsOptional()
  @IsObject()
  designerNotes?: TemplateDesignerNotes;

  @IsOptional()
  @IsObject()
  workflow?: TemplateWorkflowConfig;

  @IsOptional()
  @IsObject()
  certificationMeta?: TemplateCertificationMeta;
}
