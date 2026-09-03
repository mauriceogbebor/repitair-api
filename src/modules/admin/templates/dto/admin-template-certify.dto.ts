import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";

/** Elevate a template draft's certification. Guarded by `templates.certify`. */
export class AdminTemplateCertifyDto {
  @IsIn(["approved", "certified"])
  status!: "approved" | "certified";

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reviewNotes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  summary?: string;
}
