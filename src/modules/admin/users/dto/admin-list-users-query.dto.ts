import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

const USER_SORT_FIELDS = ["createdAt", "fullName", "email", "lastLoginAt", "repitCount"] as const;
const SORT_ORDERS = ["asc", "desc"] as const;
const USER_STATUSES = ["active", "suspended"] as const;
const VERIFICATION_STATUSES = ["verified", "unverified"] as const;
const RESTRICTION_STATUSES = ["active", "none"] as const;

export class AdminListUsersQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(USER_STATUSES)
  status?: (typeof USER_STATUSES)[number];

  @IsOptional()
  @IsIn(VERIFICATION_STATUSES)
  verification?: (typeof VERIFICATION_STATUSES)[number];

  @IsOptional()
  @IsIn(RESTRICTION_STATUSES)
  restriction?: (typeof RESTRICTION_STATUSES)[number];

  @IsOptional()
  @IsString()
  signupFrom?: string;

  @IsOptional()
  @IsString()
  signupTo?: string;

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
  @IsIn(USER_SORT_FIELDS)
  sortBy?: (typeof USER_SORT_FIELDS)[number];

  @IsOptional()
  @IsIn(SORT_ORDERS)
  sortOrder?: (typeof SORT_ORDERS)[number];
}
