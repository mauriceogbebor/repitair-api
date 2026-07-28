import { ArrayMinSize, IsArray, IsEmail, IsString, IsUUID, MaxLength, MinLength } from "class-validator";

export class AdminInviteAdminDto {
  @IsString() @MinLength(2) @MaxLength(120) fullName!: string;
  @IsEmail() @MaxLength(320) email!: string;
  @IsArray() @ArrayMinSize(1) @IsUUID("4", { each: true }) roleIds!: string[];
}
