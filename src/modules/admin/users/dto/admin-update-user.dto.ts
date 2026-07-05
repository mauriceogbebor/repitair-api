import { IsEmail, IsOptional, IsString, MaxLength } from "class-validator";

export class AdminUpdateUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  fullName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  country?: string;
}
