import { IsIn, IsString, MaxLength, MinLength } from "class-validator";

export class AdminEscalateSupportTicketDto {
  @IsIn(["support_lead", "operations", "trust_safety", "engineering_sre", "security_compliance", "content_operations"] as const)
  destination!: string;
  @IsIn(["low", "medium", "high", "critical"] as const) severity!: string;
  @IsString() @MinLength(3) @MaxLength(2000) reason!: string;
  @IsString() @MinLength(3) @MaxLength(2000) requestedAction!: string;
}
