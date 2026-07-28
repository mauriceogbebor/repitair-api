import { IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

const SUPPORT_PRIORITIES = ["low", "medium", "high", "critical"] as const;

export class AdminUpdateSupportTicketPriorityDto {
  @IsIn(SUPPORT_PRIORITIES)
  priority!: (typeof SUPPORT_PRIORITIES)[number];

  @IsOptional() @IsString() @MinLength(3) @MaxLength(500)
  reason?: string;
}
