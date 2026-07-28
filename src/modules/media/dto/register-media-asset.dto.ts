import { IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from "class-validator";

export class RegisterMediaAssetDto {
  @IsString() @MinLength(1) @MaxLength(300) originalKey!: string;
  @IsString() @MinLength(1) @MaxLength(2000) originalUrl!: string;
  @IsString() @MinLength(1) @MaxLength(100) mimeType!: string;

  @IsOptional() @IsInt() @Min(1) width?: number;
  @IsOptional() @IsInt() @Min(1) height?: number;
  @IsOptional() @IsInt() @Min(0) bytes?: number;
}
