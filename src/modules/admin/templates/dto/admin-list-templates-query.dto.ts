import { Type } from "class-transformer";
import { IsBooleanString, IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

const TEMPLATE_STATUSES = ["draft", "published", "archived"] as const;
const TEMPLATE_SORT_FIELDS = ["updatedAt", "createdAt", "name", "sortOrder", "templateVersion", "category"] as const;
const SORT_ORDERS = ["asc", "desc"] as const;

export class AdminListTemplatesQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsIn(TEMPLATE_STATUSES)
  status?: (typeof TEMPLATE_STATUSES)[number];

  @IsOptional()
  @IsBooleanString()
  active?: string;

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
  @IsIn(TEMPLATE_SORT_FIELDS)
  sortBy?: (typeof TEMPLATE_SORT_FIELDS)[number];

  @IsOptional()
  @IsIn(SORT_ORDERS)
  sortOrder?: (typeof SORT_ORDERS)[number];
}
