import { Transform } from "class-transformer";
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from "class-validator";
import { MEDIA_PROCESSING_PURPOSES, type MediaProcessingPurpose } from "../media-processing-purpose";

/**
 * The client identifies the selected template; it never declares what that
 * template is allowed to do. The backend resolves published capabilities.
 */
export class ResolveTemplateMediaDto {
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  templateId!: string;

  /**
   * Processing ownership. Omitted / unknown defaults to `canvasSubject` so every
   * existing caller is unchanged; `iceGirlWidgetSubject` scopes the second slot.
   */
  @IsOptional()
  @IsIn(MEDIA_PROCESSING_PURPOSES)
  purpose?: MediaProcessingPurpose;
}
