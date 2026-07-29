import { Transform } from "class-transformer";
import { IsNotEmpty, IsString, MaxLength } from "class-validator";

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
}
