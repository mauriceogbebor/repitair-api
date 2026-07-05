import { IsOptional, IsString } from "class-validator";

export class AdminReopenSupportTicketDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
