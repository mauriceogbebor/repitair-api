import { IsOptional, IsString, MaxLength } from "class-validator";

export class AdminTemplateActionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  summary?: string;
}
