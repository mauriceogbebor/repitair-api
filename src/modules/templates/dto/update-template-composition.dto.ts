import { IsInt, IsObject, IsOptional } from "class-validator";

export class UpdateTemplateCompositionDto {
  @IsOptional()
  @IsInt()
  templateVersion?: number | null;

  @IsOptional()
  @IsObject()
  canvasMeta?: Record<string, unknown> | null;

  @IsOptional()
  @IsObject()
  composition?: Record<string, unknown> | null;
}
