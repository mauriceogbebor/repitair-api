import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from "class-validator";

export class AdminUpdateVersionsDto {
  @IsOptional() @IsString() @MaxLength(20)
  minIosVersion?: string | null;

  @IsOptional() @IsString() @MaxLength(20)
  minAndroidVersion?: string | null;

  @IsOptional() @IsIn(["optional", "recommended", "mandatory"])
  updatePolicy?: "optional" | "recommended" | "mandatory";
}

export class AdminMaintenanceDto {
  @IsBoolean()
  enabled!: boolean;

  @IsOptional() @IsString() @MaxLength(120)
  title?: string | null;

  @IsOptional() @IsString() @MaxLength(500)
  message?: string | null;

  @IsOptional() @IsString() @MaxLength(60)
  estimatedCompletion?: string | null;

  @IsOptional() @IsString() @MaxLength(300)
  supportLink?: string | null;
}

export class AdminIncidentDto {
  /** When false/absent, the incident banner is cleared. */
  @IsOptional() @IsBoolean()
  active?: boolean;

  @IsOptional() @IsString() @MaxLength(120)
  title?: string;

  @IsOptional() @IsString() @MaxLength(500)
  message?: string;

  @IsOptional() @IsIn(["info", "warning", "critical"])
  severity?: "info" | "warning" | "critical";

  @IsOptional() @IsString()
  startsAt?: string | null;

  @IsOptional() @IsString()
  expiresAt?: string | null;
}

export class AdminFeatureFlagDto {
  @IsBoolean()
  enabled!: boolean;
}
