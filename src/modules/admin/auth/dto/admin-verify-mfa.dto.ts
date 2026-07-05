import { IsString, Length } from "class-validator";

export class AdminVerifyMfaDto {
  @IsString()
  ticket!: string;

  @IsString()
  @Length(6, 6)
  code!: string;
}
