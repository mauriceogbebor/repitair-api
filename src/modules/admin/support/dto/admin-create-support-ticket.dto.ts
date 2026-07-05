import { IsArray, IsEmail, IsIn, IsOptional, IsString } from "class-validator";

const SUPPORT_PRIORITIES = ["low", "medium", "high", "critical"] as const;

export class AdminCreateSupportTicketDto {
  @IsString()
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  subject!: string;

  @IsString()
  message!: string;

  @IsOptional()
  @IsIn(SUPPORT_PRIORITIES)
  priority?: (typeof SUPPORT_PRIORITIES)[number];

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
}
