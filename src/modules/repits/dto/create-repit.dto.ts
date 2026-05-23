import { IsEnum, IsOptional, IsString, IsUrl } from "class-validator";

enum Platform {
  SPOTIFY = "spotify",
  APPLE_MUSIC = "apple-music",
}

export class CreateRepitDto {
  @IsString()
  templateId!: string;

  @IsOptional()
  @IsUrl({}, { message: "songLink must be a valid URL" })
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
  @IsUrl({}, { message: "albumArt must be a valid URL" })
  albumArt?: string;

  @IsOptional()
  durationMs?: number;

  @IsOptional()
  @IsUrl({}, { message: "backgroundPhotoUrl must be a valid URL" })
  backgroundPhotoUrl?: string;
}
