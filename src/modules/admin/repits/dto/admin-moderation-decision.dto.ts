import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from "class-validator";

const ACTIONS = ["dismiss", "archive", "remove", "escalate", "forward_support"] as const;

export class AdminModerationDecisionDto {
  @IsUUID()
  reportId!: string;

  @IsIn(ACTIONS)
  action!: (typeof ACTIONS)[number];

  @IsString() @MinLength(3) @MaxLength(1000)
  reason!: string;

  @IsString() @MinLength(3) @MaxLength(100)
  policyKey!: string;

  @ValidateIf((dto: AdminModerationDecisionDto) => dto.action === "escalate")
  @IsIn(["support", "compliance"] as const)
  escalationTarget?: "support" | "compliance";

  @IsOptional() @IsString() @MaxLength(200)
  idempotencyKey?: string;
}
