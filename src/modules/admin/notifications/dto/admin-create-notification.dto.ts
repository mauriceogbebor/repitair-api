import { IsArray, IsIn, IsObject, IsOptional, IsString } from "class-validator";

const NOTIFICATION_TYPES = ["push", "in_app", "announcement", "marketing", "system", "information"] as const;

export class AdminCreateNotificationDto {
  @IsString()
  title!: string;

  @IsString()
  message!: string;

  @IsString()
  audience!: string;

  @IsOptional()
  @IsObject()
  audienceFilters?: Record<string, unknown>;

  @IsIn(NOTIFICATION_TYPES)
  type!: (typeof NOTIFICATION_TYPES)[number];

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  deepLink?: string;

  @IsOptional()
  @IsString()
  ctaLabel?: string;
}
