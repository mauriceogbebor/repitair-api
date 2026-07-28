import { IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class AdminOpenModerationReportDto {
  @IsIn(["safety", "harassment", "hate", "sexual", "copyright", "spam", "other"] as const)
  reportType!: "safety" | "harassment" | "hate" | "sexual" | "copyright" | "spam" | "other";

  @IsIn(["low", "medium", "high", "critical"] as const)
  priority!: "low" | "medium" | "high" | "critical";

  @IsString() @MinLength(3) @MaxLength(1000)
  reason!: string;

  @IsOptional() @IsString() @MaxLength(2000)
  evidenceComment?: string;
}
