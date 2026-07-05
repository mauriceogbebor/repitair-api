import { IsOptional, IsString } from "class-validator";

export class AdminTemplateActionDto {
  @IsOptional()
  @IsString()
  summary?: string;
}
