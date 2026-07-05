import { IsOptional, IsString } from "class-validator";

export class AdminScheduleSpotlightDto {
  @IsOptional()
  @IsString()
  startsAt?: string;

  @IsOptional()
  @IsString()
  expiresAt?: string;
}
