import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export enum MusicProviderDto {
  SPOTIFY = "spotify",
  APPLE_MUSIC = "apple-music",
}

export enum PlaylistSortDto {
  RECENT = "recent",
  ALPHABETICAL = "alphabetical",
  RECENTLY_IMPORTED = "recently_imported",
}

export class MusicLibraryQueryDto {
  @IsEnum(MusicProviderDto)
  provider!: MusicProviderDto;

  @IsOptional()
  @Transform(({ value }) => String(value ?? "").trim())
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsEnum(PlaylistSortDto)
  sort: PlaylistSortDto = PlaylistSortDto.RECENT;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
}

export class PlaylistTracksQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
}

export class CreateMusicCollectionDto {
  @IsEnum(MusicProviderDto)
  provider!: MusicProviderDto;

  @Transform(({ value }) => String(value ?? "").trim())
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  playlistId!: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(255, { each: true })
  trackIds?: string[];
}

export class RecordPlaylistImportDto {
  @IsEnum(MusicProviderDto)
  provider!: MusicProviderDto;

  @Transform(({ value }) => String(value ?? "").trim())
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  playlistId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  trackCount!: number;
}
