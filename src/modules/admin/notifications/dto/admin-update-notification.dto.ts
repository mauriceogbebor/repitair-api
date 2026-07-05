import { IsIn, IsObject, IsOptional, IsString } from "class-validator";

const NOTIFICATION_TYPES = ["push", "in_app", "announcement", "marketing", "system", "information"] as const;
const NOTIFICATION_STATUSES = ["draft", "scheduled", "sent", "cancelled", "failed"] as const;

export class AdminUpdateNotificationDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  message?: string;

  @IsOptional()
  @IsString()
  audience?: string;

  @IsOptional()
  @IsObject()
  audienceFilters?: Record<string, unknown>;

  @IsOptional()
  @IsIn(NOTIFICATION_TYPES)
  type?: (typeof NOTIFICATION_TYPES)[number];

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  deepLink?: string;

  @IsOptional()
  @IsString()
  ctaLabel?: string;

  @IsOptional()
  @IsIn(NOTIFICATION_STATUSES)
  status?: (typeof NOTIFICATION_STATUSES)[number];
}
