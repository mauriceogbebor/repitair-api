import { IsString, MaxLength, MinLength } from "class-validator";

export class LyricsQueryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  artist!: string;
}
