import { Transform } from "class-transformer";
import { IsNotEmpty, IsString, MaxLength, MinLength } from "class-validator";

export class AdminAddSupportTicketNoteDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: "A non-empty note body is required" })
  @MinLength(1)
  @MaxLength(5000)
  body!: string;
}
