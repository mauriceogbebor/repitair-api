import { IsIn, IsISO8601, IsOptional } from "class-validator";

export const DASHBOARD_RANGE_PRESETS = ["today", "7d", "30d", "90d", "year", "custom"] as const;
export type DashboardRangePreset = (typeof DASHBOARD_RANGE_PRESETS)[number];

export class AdminDashboardQueryDto {
  @IsOptional()
  @IsIn(DASHBOARD_RANGE_PRESETS)
  range: DashboardRangePreset = "30d";

  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}
