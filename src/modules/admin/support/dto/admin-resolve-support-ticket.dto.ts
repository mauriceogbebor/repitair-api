import { IsOptional, IsString } from "class-validator";

export class AdminResolveSupportTicketDto {
  @IsOptional()
  @IsString()
  resolutionNote?: string;
}
