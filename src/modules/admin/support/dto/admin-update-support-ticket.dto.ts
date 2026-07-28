import { Transform } from "class-transformer";
import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUUID, MaxLength, MinLength } from "class-validator";

const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);
const trimArray = ({ value }: { value: unknown }) =>
  Array.isArray(value) ? value.map((item) => (typeof item === "string" ? item.trim() : item)).filter(Boolean) : value;

export class AdminUpdateSupportTicketDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  subject?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  message?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  category?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) subcategory?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) issueType?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) productArea?: string;

  @IsOptional()
  @Transform(trimArray)
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  tags?: string[];

  @IsOptional()
  @IsUUID()
  relatedUserId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID("4", { each: true })
  relatedRepitIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID("4", { each: true })
  relatedNotificationIds?: string[];
}
