import { IsEnum, IsString } from "class-validator";

export class RegisterTokenDto {
  @IsString()
  pushToken!: string;

  @IsEnum(["ios", "android"])
  platform!: string;
}
