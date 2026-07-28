import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from "class-validator";

const STATUSES = ["open", "under_review", "escalated", "resolved"] as const;
const PRIORITIES = ["low", "medium", "high", "critical"] as const;
const SORT_FIELDS = ["createdAt", "updatedAt", "priority", "status"] as const;

export class AdminListModerationReportsQueryDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsIn(STATUSES) status?: (typeof STATUSES)[number];
  @IsOptional() @IsIn(PRIORITIES) priority?: (typeof PRIORITIES)[number];
  @IsOptional() @IsString() reportType?: string;
  @IsOptional() @IsUUID() assignedAdminUserId?: string;
  @IsOptional() @IsString() dateFrom?: string;
  @IsOptional() @IsString() dateTo?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
  @IsOptional() @IsIn(SORT_FIELDS) sortBy?: (typeof SORT_FIELDS)[number];
  @IsOptional() @IsIn(["asc", "desc"] as const) sortOrder?: "asc" | "desc";
}
