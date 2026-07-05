import { IsOptional, IsString, MaxLength } from "class-validator";

export class AdminArchiveRepitDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
