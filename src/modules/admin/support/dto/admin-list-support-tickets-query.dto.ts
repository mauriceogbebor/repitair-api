import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

const SUPPORT_STATUSES = ["new", "open", "assigned", "waiting_for_customer", "waiting_for_internal", "escalated", "resolved", "closed", "reopened"] as const;
const SUPPORT_PRIORITIES = ["low", "medium", "high", "critical"] as const;
const SUPPORT_SORT_FIELDS = ["createdAt", "updatedAt", "priority", "status", "subject", "sla"] as const;
const SORT_ORDERS = ["asc", "desc"] as const;

export class AdminListSupportTicketsQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(SUPPORT_STATUSES)
  status?: (typeof SUPPORT_STATUSES)[number];

  @IsOptional()
  @IsIn(SUPPORT_PRIORITIES)
  priority?: (typeof SUPPORT_PRIORITIES)[number];

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  assignedAdminUserId?: string;

  @IsOptional() @IsIn(["assigned", "unassigned"] as const)
  assignment?: "assigned" | "unassigned";

  @IsOptional() @IsString()
  source?: string;

  @IsOptional() @IsIn(["active", "none"] as const)
  escalation?: "active" | "none";

  @IsOptional() @IsIn(["healthy", "due_soon", "breached", "paused"] as const)
  slaState?: "healthy" | "due_soon" | "breached" | "paused";

  @IsOptional()
  @IsString()
  tag?: string;

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
  @IsIn(SUPPORT_SORT_FIELDS)
  sortBy?: (typeof SUPPORT_SORT_FIELDS)[number];

  @IsOptional()
  @IsIn(SORT_ORDERS)
  sortOrder?: (typeof SORT_ORDERS)[number];
}
