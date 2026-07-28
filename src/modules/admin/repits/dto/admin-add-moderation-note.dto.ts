import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from "class-validator";

export class AdminAddModerationNoteDto {
  @IsOptional() @IsUUID() reportId?: string;
  @IsString() @MinLength(1) @MaxLength(4000) body!: string;
}
