import { Type } from "class-transformer";
import { IsBooleanString, IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

const SPOTLIGHT_STATUSES = ["draft", "scheduled", "active", "paused", "expired", "archived"] as const;
const SPOTLIGHT_SORT_FIELDS = ["updatedAt", "createdAt", "priority", "title", "startsAt", "expiresAt", "status"] as const;
const SORT_ORDERS = ["asc", "desc"] as const;

export class AdminListSpotlightQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(SPOTLIGHT_STATUSES)
  status?: (typeof SPOTLIGHT_STATUSES)[number];

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  @IsBooleanString()
  active?: string;

  @IsOptional()
  @IsBooleanString()
  scheduled?: string;

  @IsOptional()
  @IsBooleanString()
  expired?: string;

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
  @IsIn(SPOTLIGHT_SORT_FIELDS)
  sortBy?: (typeof SPOTLIGHT_SORT_FIELDS)[number];

  @IsOptional()
  @IsIn(SORT_ORDERS)
  sortOrder?: (typeof SORT_ORDERS)[number];
}
