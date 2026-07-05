import { IsOptional, IsString } from "class-validator";

export class AdminNotificationActionDto {
  @IsOptional()
  @IsString()
  note?: string;
}
