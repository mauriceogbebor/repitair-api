import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

const REPIT_SORT_FIELDS = ["createdAt", "title", "status", "templateName", "userName"] as const;
const SORT_ORDERS = ["asc", "desc"] as const;
const REPIT_STATUSES = ["active", "flagged", "archived", "deleted"] as const;

export class AdminListRepitsQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  templateId?: string;

  @IsOptional()
  @IsIn(REPIT_STATUSES)
  status?: (typeof REPIT_STATUSES)[number];

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
  @IsIn(REPIT_SORT_FIELDS)
  sortBy?: (typeof REPIT_SORT_FIELDS)[number];

  @IsOptional()
  @IsIn(SORT_ORDERS)
  sortOrder?: (typeof SORT_ORDERS)[number];
}
