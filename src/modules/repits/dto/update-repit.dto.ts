import { IsOptional, IsString } from "class-validator";

export class UpdateRepitDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  artist?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  backgroundPhotoUrl?: string;
}
