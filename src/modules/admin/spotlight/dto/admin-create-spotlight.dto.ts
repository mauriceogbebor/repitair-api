import { IsEmail, IsISO8601, IsIn, IsInt, IsOptional, IsString, IsUrl, MaxLength, Min, MinLength } from "class-validator";
import { IsSupportedSpotlightDestination } from "../spotlight-destination";
import { IsSupportedSpotlightSongLink } from "../spotlight-song-link";

export class AdminCreateSpotlightDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  title!: string;

  @IsOptional()
  @IsString()
  subtitle?: string | null;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  artist!: string;

  @IsOptional()
  @IsString()
  song?: string | null;

  @IsOptional()
  @IsString()
  @IsSupportedSpotlightSongLink({
    message: "songLink must be a Spotify or Apple Music track URL",
  })
  songLink?: string | null;

  @IsUrl({ protocols: ["https"], require_protocol: true })
  albumArt!: string;

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
    message: "deepLink must start a fresh Repit from the template picker",
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
