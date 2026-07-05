import { IsOptional, IsString } from "class-validator";

export class AdminSpotlightActionDto {
  @IsOptional()
  @IsString()
  note?: string;
}
