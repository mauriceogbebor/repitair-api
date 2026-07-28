import { IsDateString, IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class AdminAccessReviewDto {
  @IsIn(["approved", "revoked", "postponed"]) outcome!: "approved" | "revoked" | "postponed";
  @IsString() @MinLength(3) @MaxLength(1000) rationale!: string;
  @IsOptional() @IsDateString() nextReviewAt?: string;
}
