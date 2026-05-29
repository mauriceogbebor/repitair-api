import { IsString, IsOptional, IsEnum, IsInt, IsDateString, Min } from "class-validator";

export class UpdateSpotlightDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  artist?: string;

  @IsString()
  @IsOptional()
  albumArt?: string;

  @IsEnum(["NEW_SINGLE", "NEW_ALBUM", "TRENDING"])
  @IsOptional()
  tag?: "NEW_SINGLE" | "NEW_ALBUM" | "TRENDING";

  @IsString()
  @IsOptional()
  deepLink?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  priority?: number;

  @IsEnum(["pending", "active", "paused", "expired"])
  @IsOptional()
  status?: "pending" | "active" | "paused" | "expired";

  @IsDateString()
  @IsOptional()
  startsAt?: string;

  @IsDateString()
  @IsOptional()
  expiresAt?: string;
}
