import { Transform } from "class-transformer";
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength } from "class-validator";

const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);
const trimArray = ({ value }: { value: unknown }) =>
  Array.isArray(value) ? value.map((item) => (typeof item === "string" ? item.trim() : item)).filter(Boolean) : value;

export class AdminClassifySupportTicketDto {
  @IsIn(["general", "account", "billing", "bug", "technical", "music", "content", "safety", "privacy", "other"] as const)
  category!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) subcategory?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) issueType?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) productArea?: string;
  @IsOptional() @Transform(trimArray) @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(50, { each: true }) tags?: string[];
}
