import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

const NOTIFICATION_STATUSES = ["draft", "scheduled", "sent", "cancelled", "failed"] as const;
const NOTIFICATION_TYPES = ["push", "in_app", "announcement", "marketing", "system", "information"] as const;
const NOTIFICATION_SORT_FIELDS = ["createdAt", "updatedAt", "scheduledAt", "sentAt", "status", "title"] as const;
const SORT_ORDERS = ["asc", "desc"] as const;

export class AdminListNotificationsQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(NOTIFICATION_STATUSES)
  status?: (typeof NOTIFICATION_STATUSES)[number];

  @IsOptional()
  @IsIn(NOTIFICATION_TYPES)
  type?: (typeof NOTIFICATION_TYPES)[number];

  @IsOptional()
  @IsString()
  audience?: string;

  @IsOptional()
  @IsString()
  dateFrom?: string;

  @IsOptional()
  @IsString()
  dateTo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @IsOptional()
  @IsIn(NOTIFICATION_SORT_FIELDS)
  sortBy?: (typeof NOTIFICATION_SORT_FIELDS)[number];

  @IsOptional()
  @IsIn(SORT_ORDERS)
  sortOrder?: (typeof SORT_ORDERS)[number];
}
