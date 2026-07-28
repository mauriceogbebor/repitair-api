import { Type } from "class-transformer";
import { IsInt, IsString, Max, MaxLength, Min, MinLength } from "class-validator";

export class AdminBreakGlassDto {
  @IsString() @MinLength(10) @MaxLength(1000) reason!: string;
  @Type(() => Number) @IsInt() @Min(15) @Max(120) durationMinutes!: number;
}
