import { IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

const SUPPORT_STATUSES = ["open", "assigned", "waiting_for_customer", "waiting_for_internal", "escalated", "closed"] as const;

export class AdminUpdateSupportTicketStatusDto {
  @IsIn(SUPPORT_STATUSES)
  status!: (typeof SUPPORT_STATUSES)[number];

  @IsOptional() @IsString() @MinLength(3) @MaxLength(500)
  reason?: string;
}
