import { IsISO8601, IsOptional } from "class-validator";

export class AdminScheduleSpotlightDto {
  @IsISO8601()
  startsAt!: string;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string | null;
}
