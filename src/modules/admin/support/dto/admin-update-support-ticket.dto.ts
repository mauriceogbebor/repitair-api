import { IsArray, IsOptional, IsString } from "class-validator";

export class AdminUpdateSupportTicketDto {
  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  message?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsArray()
  tags?: string[];

  @IsOptional()
  @IsString()
  relatedUserId?: string;

  @IsOptional()
  @IsArray()
  relatedRepitIds?: string[];

  @IsOptional()
  @IsArray()
  relatedNotificationIds?: string[];
}
