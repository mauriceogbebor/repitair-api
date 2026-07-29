import { IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from "class-validator";

/**
 * Registration accepts ONLY a server-owned storage key (issued by the uploads
 * endpoint). It deliberately does NOT accept a URL — the backend derives any URL
 * it needs from the key — which removes the arbitrary-URL/SSRF vector. The key
 * must be a plain object key (uuid + extension); slashes and traversal are
 * rejected at the DTO boundary and again in the storage layer.
 */
export class RegisterMediaAssetDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  @Matches(/^[A-Za-z0-9._-]+$/, { message: "originalKey must be a plain storage key" })
  originalKey!: string;

  @IsString() @MinLength(1) @MaxLength(100) mimeType!: string;

  // Optional client hints only — never trusted; real values come from the bytes.
  @IsOptional() @IsInt() @Min(1) width?: number;
  @IsOptional() @IsInt() @Min(1) height?: number;
  @IsOptional() @IsInt() @Min(0) bytes?: number;
}
