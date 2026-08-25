import { IsEmail, IsISO8601, IsIn, IsInt, IsOptional, IsString, IsUrl, MaxLength, Min, MinLength } from "class-validator";
import { IsSupportedSpotlightDestination } from "../spotlight-destination";

export class AdminUpdateSpotlightDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsString()
  subtitle?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  artist?: string;

  @IsOptional()
  @IsString()
  song?: string | null;

  @IsOptional()
  @IsUrl({ protocols: ["https"], require_protocol: true })
  albumArt?: string;

  @IsOptional()
  @IsUrl({ protocols: ["https"], require_protocol: true })
  backgroundImage?: string | null;

  @IsOptional()
  @IsIn(["editorial", "featured-release", "release", "event", "promotion"])
  campaignType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  buttonLabel?: string | null;

  @IsOptional()
  @IsString()
  @IsSupportedSpotlightDestination({
    message: "deepLink must be a supported Repitair app path or an HTTPS URL",
  })
  deepLink?: string | null;

  @IsOptional()
  @IsIn(["NEW_SINGLE", "NEW_ALBUM", "TRENDING"])
  tag?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @IsOptional()
  @IsISO8601()
  startsAt?: string | null;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string | null;

  @IsOptional()
  @IsEmail()
  submitterEmail?: string | null;
}
