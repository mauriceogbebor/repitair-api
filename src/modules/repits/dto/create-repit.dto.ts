import { IsOptional, IsString } from "class-validator";

export class CreateRepitDto {
  @IsString()
  templateId!: string;

  @IsString()
  songLink!: string;

  @IsOptional()
  @IsString()
  songTitle?: string;

  @IsOptional()
  @IsString()
  artistName?: string;

  @IsOptional()
  @IsString()
  platform?: string;

  @IsOptional()
  @IsString()
  backgroundPhotoUrl?: string;
}
