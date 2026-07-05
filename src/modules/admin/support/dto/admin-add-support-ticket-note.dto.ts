import { IsString } from "class-validator";

export class AdminAddSupportTicketNoteDto {
  @IsString()
  body!: string;
}
