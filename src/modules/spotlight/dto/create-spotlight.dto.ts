import { IsString, IsOptional, IsEnum, IsInt, IsDateString, IsEmail, Min } from "class-validator";

export class CreateSpotlightDto {
  @IsString()
  title!: string;

  @IsString()
  artist!: string;

  @IsString()
  albumArt!: string;

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

  @IsDateString()
  @IsOptional()
  startsAt?: string;

  @IsDateString()
  @IsOptional()
  expiresAt?: string;

  @IsEmail()
  @IsOptional()
  submitterEmail?: string;
}
