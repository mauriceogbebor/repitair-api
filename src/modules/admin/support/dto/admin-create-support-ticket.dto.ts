import { Transform } from "class-transformer";
import { ArrayMaxSize, IsArray, IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, MinLength } from "class-validator";

const SUPPORT_PRIORITIES = ["low", "medium", "high", "critical"] as const;
const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);
const trimArray = ({ value }: { value: unknown }) =>
  Array.isArray(value) ? value.map((item) => (typeof item === "string" ? item.trim() : item)).filter(Boolean) : value;

export class AdminCreateSupportTicketDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @Transform(trim)
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  subject!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  message!: string;

  @IsOptional()
  @IsIn(SUPPORT_PRIORITIES)
  priority?: (typeof SUPPORT_PRIORITIES)[number];

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  category?: string;

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
}
