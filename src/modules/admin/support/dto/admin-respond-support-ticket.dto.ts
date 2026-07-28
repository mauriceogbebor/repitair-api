import { Transform } from "class-transformer";
import { IsNotEmpty, IsString, IsUUID, MaxLength, MinLength } from "class-validator";

export class AdminRespondSupportTicketDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: "A non-empty response body is required" })
  @MinLength(1)
  @MaxLength(10000)
  body!: string;

  @IsUUID()
  idempotencyKey!: string;
}
