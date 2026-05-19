import { IsEnum, IsOptional, IsString, IsUrl } from "class-validator";

enum Status {
  DRAFT = "draft",
  SAVED = "saved",
  SHARED = "shared",
  PUBLISHED = "published",
}

export class UpdateRepitDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  artist?: string;

  @IsOptional()
  @IsEnum(Status)
  status?: string;

  @IsOptional()
  @IsUrl({}, { message: "backgroundPhotoUrl must be a valid URL" })
  backgroundPhotoUrl?: string;
}
