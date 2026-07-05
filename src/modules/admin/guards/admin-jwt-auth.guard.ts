import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { AdminRequest } from "../admin.types";
import { AdminAuthService } from "../auth/admin-auth.service";
import { AdminTokenService } from "../auth/admin-token.service";

@Injectable()
export class AdminJwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokenService: AdminTokenService,
    private readonly adminAuthService: AdminAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const token = this.extractBearerToken(request.headers.authorization);

    if (!token) {
      throw new UnauthorizedException("Missing admin access token");
    }

    const payload = this.tokenService.verifyAccessToken(token);
    const actor = await this.adminAuthService.resolveActor(payload.sub);

    if (!actor) {
      throw new UnauthorizedException("Admin account no longer exists");
    }

    request.adminUser = actor;
    return true;
  }

  private extractBearerToken(header?: string): string | null {
    if (!header) {
      return null;
    }

    const [scheme, token] = header.split(" ");
    if (scheme?.toLowerCase() !== "bearer" || !token) {
      return null;
    }

    return token;
  }
}
