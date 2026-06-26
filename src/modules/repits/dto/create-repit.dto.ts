import { Type } from "class-transformer";
import {
  IsArray,
  IsEnum,
  IsNumber,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  ValidateNested,
} from "class-validator";

import {
  RepitPlatform,
  RepitSongSelectionDto,
  RepitWidgetTransformDto,
} from "./repit-presentation.dto";
import { IsValidEditorState } from "./editor-state.dto";

export class CreateRepitDto {
  @IsString()
  templateId!: string;

  @IsOptional()
  @IsInt()
  templateVersion?: number | null;

  @IsOptional()
  @IsObject()
  canvasMeta?: Record<string, unknown> | null;

  @IsOptional()
  @IsObject()
  composition?: Record<string, unknown> | null;

  @IsOptional()
  @IsUrl({}, { message: "songLink must be a valid URL" })
  songLink?: string | null;

  @IsOptional()
  @IsString()
  songTitle?: string;

  @IsOptional()
  @IsString()
  artistName?: string;

  @IsOptional()
  @IsEnum(RepitPlatform)
  platform?: RepitPlatform;

  @IsOptional()
  @IsUrl({}, { message: "albumArt must be a valid URL" })
  albumArt?: string | null;

  @IsOptional()
  @IsNumber()
  durationMs?: number | null;

  @IsOptional()
  @IsUrl({}, { message: "backgroundPhotoUrl must be a valid URL" })
  backgroundPhotoUrl?: string | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RepitSongSelectionDto)
  selectedSongs?: RepitSongSelectionDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RepitWidgetTransformDto)
  widgetTransforms?: RepitWidgetTransformDto[];

  @IsOptional()
  @IsValidEditorState()
  editorState?: Record<string, unknown> | null;
}
