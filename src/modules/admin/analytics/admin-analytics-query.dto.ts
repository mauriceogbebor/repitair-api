import { IsIn, IsISO8601, IsOptional } from "class-validator";

export const ANALYTICS_RANGE_PRESETS = ["today", "7d", "30d", "90d", "year", "custom"] as const;
export type AnalyticsRangePreset = (typeof ANALYTICS_RANGE_PRESETS)[number];

export class AdminAnalyticsQueryDto {
  @IsOptional()
  @IsIn(ANALYTICS_RANGE_PRESETS)
  range: AnalyticsRangePreset = "30d";

  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}
