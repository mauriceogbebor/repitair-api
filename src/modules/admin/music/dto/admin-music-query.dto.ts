import { Type } from "class-transformer";
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from "class-validator";

export enum AdminMusicProvider {
  Spotify = "spotify",
  AppleMusic = "apple-music",
}

export enum AdminMusicConnectionStatus {
  Connected = "connected",
  ReauthRequired = "reauth_required",
  Disconnected = "disconnected",
}

export class AdminListMusicConnectionsQueryDto {
  @IsOptional()
  @IsEnum(AdminMusicConnectionStatus)
  status?: AdminMusicConnectionStatus;

  @IsOptional()
  @IsEnum(AdminMusicProvider)
  provider?: AdminMusicProvider;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  search?: string;

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
  pageSize = 20;
}

export class AdminMusicUserParamsDto {
  @IsUUID()
  userId!: string;
}

export class AdminMusicConnectionParamsDto extends AdminMusicUserParamsDto {
  @IsEnum(AdminMusicProvider)
  provider!: AdminMusicProvider;
}
