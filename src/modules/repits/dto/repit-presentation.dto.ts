import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
} from "class-validator";

export enum RepitPlatform {
  SPOTIFY = "spotify",
  APPLE_MUSIC = "apple-music",
}

export class RepitSongSelectionDto {
  @IsOptional()
  @IsUrl({}, { message: "songLink must be a valid URL" })
  songLink?: string | null;

  @IsString()
  songTitle!: string;

  @IsString()
  artistName!: string;

  @IsEnum(RepitPlatform)
  platform!: RepitPlatform;

  @IsOptional()
  @IsNumber()
  durationMs?: number | null;

  @IsOptional()
  @IsUrl({}, { message: "albumArtUrl must be a valid URL" })
  albumArtUrl?: string | null;
}

export class RepitWidgetTransformDto {
  @IsNumber()
  x!: number;

  @IsNumber()
  y!: number;

  @IsNumber()
  scale!: number;

  @IsNumber()
  rotation!: number;
}
