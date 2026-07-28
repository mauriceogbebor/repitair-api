import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from "class-validator";

export class AdminAssignModerationReportDto {
  @IsIn(["assign", "claim", "release"] as const)
  action!: "assign" | "claim" | "release";

  @ValidateIf((dto: AdminAssignModerationReportDto) => dto.action === "assign")
  @IsUUID()
  assigneeAdminUserId?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason?: string;
}
