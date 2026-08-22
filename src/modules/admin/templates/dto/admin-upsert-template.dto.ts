import { ArrayMaxSize, IsArray, IsBoolean, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min } from "class-validator";
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
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(80)
  id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  style!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
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
  @MaxLength(80)
  layoutVariant?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  playerVariant?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  overlayOpacity?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  previewImages?: string[];

  @IsOptional()
  @IsObject()
  composition?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  canvasMeta?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(500)
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
