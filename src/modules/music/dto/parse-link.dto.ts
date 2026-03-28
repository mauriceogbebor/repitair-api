import { IsString, IsUrl } from "class-validator";

export class ParseLinkDto {
  @IsString()
  @IsUrl()
  link!: string;
}
