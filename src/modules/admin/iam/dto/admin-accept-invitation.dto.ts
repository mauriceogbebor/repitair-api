import { IsString, Matches, MinLength } from "class-validator";

export class AdminAcceptInvitationDto {
  @IsString()
  @MinLength(16)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/, {
    message: "Password must include uppercase, lowercase, number, and special characters",
  })
  password!: string;
}

export class AdminCompleteInvitationMfaDto {
  @IsString() @Matches(/^\d{6}$/) code!: string;
}
