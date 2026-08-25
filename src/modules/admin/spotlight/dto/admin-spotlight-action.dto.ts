import { IsOptional, IsString, MaxLength } from "class-validator";

export class AdminSpotlightActionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
