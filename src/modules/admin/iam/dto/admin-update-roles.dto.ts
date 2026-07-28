import { ArrayMinSize, IsArray, IsUUID } from "class-validator";

export class AdminUpdateRolesDto {
  @IsArray() @ArrayMinSize(1) @IsUUID("4", { each: true }) roleIds!: string[];
}
