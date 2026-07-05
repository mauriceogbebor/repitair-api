import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Min } from "class-validator";

export class AdminTemplateRollbackDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  versionNumber!: number;

  @IsOptional()
  @IsString()
  summary?: string;
}
