import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
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

  @IsOptional()
  @IsBoolean()
  isExplicit?: boolean | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  progressFraction?: number | null;
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
