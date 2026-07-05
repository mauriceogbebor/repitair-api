import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ADMIN_REQUIRED_PERMISSIONS_KEY } from "../admin.constants";
import type { AdminRequest } from "../admin.types";

@Injectable()
export class AdminRbacGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      ADMIN_REQUIRED_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AdminRequest>();
    const actor = request.adminUser;

    if (!actor) {
      throw new ForbiddenException("Admin actor missing from request");
    }

    const grantedPermissions = new Set(actor.permissionKeys);
    const hasAllPermissions = requiredPermissions.every((permission) => grantedPermissions.has(permission));

    if (!hasAllPermissions) {
      throw new ForbiddenException("You do not have permission to perform this admin action");
    }

    return true;
  }
}
