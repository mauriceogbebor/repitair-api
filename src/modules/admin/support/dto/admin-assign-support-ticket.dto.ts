import { IsOptional, IsString } from "class-validator";

export class AdminAssignSupportTicketDto {
  @IsOptional()
  @IsString()
  adminUserId?: string;

  @IsOptional()
  @IsString()
  adminEmail?: string;
}
