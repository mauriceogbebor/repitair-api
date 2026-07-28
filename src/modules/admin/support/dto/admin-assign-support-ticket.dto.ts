import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from "class-validator";

export class AdminAssignSupportTicketDto {
  @IsIn(["assign", "claim", "release"] as const)
  action!: "assign" | "claim" | "release";

  @ValidateIf((dto: AdminAssignSupportTicketDto) => dto.action === "assign")
  @IsUUID()
  adminUserId?: string;

  @IsOptional() @IsString() @MinLength(3) @MaxLength(500)
  reason?: string;
}
