import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from "class-validator";

export class AdminUpdateSupportEscalationDto {
  @IsIn(["accept", "assign", "resolve", "return"] as const)
  action!: "accept" | "assign" | "resolve" | "return";
  @ValidateIf((dto: AdminUpdateSupportEscalationDto) => dto.action === "assign")
  @IsUUID()
  assigneeAdminUserId?: string;
  @ValidateIf((dto: AdminUpdateSupportEscalationDto) => ["resolve", "return"].includes(dto.action))
  @IsString() @MinLength(3) @MaxLength(2000)
  outcome?: string;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
