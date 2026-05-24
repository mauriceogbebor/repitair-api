import { IsString } from "class-validator";

export class UnregisterTokenDto {
  @IsString()
  pushToken!: string;
}
