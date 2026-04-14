import { IsEnum, IsOptional, IsString, IsUrl } from "class-validator";

enum Platform {
  SPOTIFY = "spotify",
  APPLE_MUSIC = "apple-music",
}

export class CreateRepitDto {
  @IsString()
  templateId!: string;

  @IsOptional()
  @IsString()
  songLink?: string;

  @IsOptional()
  @IsString()
  songTitle?: string;

  @IsOptional()
  @IsString()
  artistName?: string;

  @IsOptional()
  @IsEnum(Platform)
  platform?: string;

  @IsOptional()
  @IsString()
  backgroundPhotoUrl?: string;
}
