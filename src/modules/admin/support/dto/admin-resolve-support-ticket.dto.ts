import { IsIn, IsString, MaxLength, MinLength } from "class-validator";

export class AdminResolveSupportTicketDto {
  @IsIn(["answered", "fixed", "account_recovered", "content_actioned", "unable_to_reproduce", "duplicate", "other"] as const)
  resolutionCategory!: string;

  @IsString() @MinLength(3) @MaxLength(2000)
  resolutionSummary!: string;
}
