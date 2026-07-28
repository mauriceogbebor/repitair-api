import { IsString, MaxLength, MinLength } from "class-validator";

export class AdminAddUserNoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;
}
