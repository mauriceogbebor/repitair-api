import { IsOptional, IsString } from "class-validator";

export class AdminNotificationScheduleDto {
  @IsString()
  scheduledAt!: string;

  @IsOptional()
  @IsString()
  note?: string;
}
