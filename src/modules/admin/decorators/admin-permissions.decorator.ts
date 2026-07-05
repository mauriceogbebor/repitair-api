import { SetMetadata } from "@nestjs/common";
import { ADMIN_REQUIRED_PERMISSIONS_KEY } from "../admin.constants";

export const AdminPermissions = (...permissions: string[]) =>
  SetMetadata(ADMIN_REQUIRED_PERMISSIONS_KEY, permissions);
