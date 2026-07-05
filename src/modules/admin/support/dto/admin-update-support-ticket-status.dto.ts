import { IsIn } from "class-validator";

const SUPPORT_STATUSES = ["new", "open", "assigned", "waiting_for_customer", "resolved", "closed"] as const;

export class AdminUpdateSupportTicketStatusDto {
  @IsIn(SUPPORT_STATUSES)
  status!: (typeof SUPPORT_STATUSES)[number];
}
