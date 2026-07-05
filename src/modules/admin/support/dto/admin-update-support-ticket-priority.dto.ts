import { IsIn } from "class-validator";

const SUPPORT_PRIORITIES = ["low", "medium", "high", "critical"] as const;

export class AdminUpdateSupportTicketPriorityDto {
  @IsIn(SUPPORT_PRIORITIES)
  priority!: (typeof SUPPORT_PRIORITIES)[number];
}
