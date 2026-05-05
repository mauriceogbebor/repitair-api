import { IsString, IsOptional, IsIn } from "class-validator";

export class SocialAuthDto {
  @IsString()
  @IsIn(["apple", "google"])
  provider!: "apple" | "google";

  /** The identity token (JWT) from Apple or Google ID token */
  @IsString()
  idToken!: string;

  /** Full name — Apple only sends this on first sign-in */
  @IsOptional()
  @IsString()
  fullName?: string;
}
