import { IsEmail, IsString, MinLength } from "class-validator";

export class ResetPasswordDto {
  @IsEmail()
  email!: string;

  /** Opaque token returned by the verify-code endpoint. */
  @IsString()
  resetToken!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}
