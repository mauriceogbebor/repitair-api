import { IsOptional, IsString, Length } from "class-validator";

export class AdminVerifyMfaDto {
  @IsOptional()
  @IsString()
  ticket?: string;

  @IsString()
  @Length(6, 6)
  code!: string;
}
