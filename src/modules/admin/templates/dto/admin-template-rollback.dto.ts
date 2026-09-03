import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";

export class AdminTemplateRollbackDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  versionNumber!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  summary?: string;
}
