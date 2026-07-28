import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from "class-validator";

const ADMIN_STATUSES = ["active", "locked", "suspended", "pending_invitation", "inactive", "disabled"] as const;
const MFA_STATUSES = ["enabled", "disabled", "reset_required"] as const;
const REVIEW_STATUSES = ["due", "current"] as const;
const SORT_FIELDS = ["fullName", "email", "status", "lastLoginAt", "lastActivityAt", "createdAt", "accessReviewDueAt"] as const;

export class AdminListAdminsQueryDto {
  @IsOptional() @IsString() @MaxLength(250) search?: string;
  @IsOptional() @IsIn(ADMIN_STATUSES) status?: (typeof ADMIN_STATUSES)[number];
  @IsOptional() @IsUUID() roleId?: string;
  @IsOptional() @IsIn(MFA_STATUSES) mfa?: (typeof MFA_STATUSES)[number];
  @IsOptional() @IsIn(REVIEW_STATUSES) review?: (typeof REVIEW_STATUSES)[number];
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
  @IsOptional() @IsIn(SORT_FIELDS) sortBy?: (typeof SORT_FIELDS)[number];
  @IsOptional() @IsIn(["asc", "desc"]) sortOrder?: "asc" | "desc";
}
