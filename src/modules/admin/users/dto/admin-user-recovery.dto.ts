import { IsIn, IsString, MaxLength, MinLength } from "class-validator";

const RECOVERY_ACTIONS = ["password_reset", "verification_resend", "sessions_revoked"] as const;

export class AdminUserRecoveryDto {
  @IsIn(RECOVERY_ACTIONS)
  action!: (typeof RECOVERY_ACTIONS)[number];

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
