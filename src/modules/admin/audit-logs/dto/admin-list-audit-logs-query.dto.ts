import { Type } from "class-transformer";
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

const AUDIT_MODULES = ["auth", "users", "repits", "templates", "spotlight", "support", "notifications", "audit"] as const;
const SORT_ORDERS = ["asc", "desc"] as const;

export class AdminListAuditLogsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(250)
  search?: string;

  @IsOptional()
  @IsIn(AUDIT_MODULES)
  module?: (typeof AUDIT_MODULES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(320)
  actor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  targetType?: string;

  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @IsOptional()
  @IsDateString()
  createdTo?: string;

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
  @IsIn(SORT_ORDERS)
  sortOrder?: (typeof SORT_ORDERS)[number];
}
