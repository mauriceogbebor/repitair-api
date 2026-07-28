import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Response } from "express";
import { TokenBlacklistService } from "../../../common/services/token-blacklist.service";
import type { AdminRequest } from "../admin.types";
import { AdminAuthService } from "../auth/admin-auth.service";
import { AdminSessionService } from "../auth/admin-session.service";
import { AdminTokenService } from "../auth/admin-token.service";
import { AdminSessionRegistryService } from "../iam/admin-session-registry.service";

@Injectable()
export class AdminJwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokenService: AdminTokenService,
    private readonly adminAuthService: AdminAuthService,
    private readonly sessionService: AdminSessionService,
    private readonly tokenBlacklistService: TokenBlacklistService,
    private readonly sessionRegistry: AdminSessionRegistryService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const token = this.sessionService.getSessionToken(request);

    if (!token) {
      this.sessionService.clearSession(response);
      throw new UnauthorizedException("Missing admin session");
    }

    try {
      if (await this.tokenBlacklistService.isBlacklisted(token)) {
        throw new UnauthorizedException("Admin session has been revoked");
      }

      const payload = this.tokenService.verifyAccessToken(token);
      if (payload.sid) await this.sessionRegistry.validateAndTouch(payload.sid, payload.sub);
      const actor = await this.adminAuthService.resolveActor(payload.sub);

      if (!actor || actor.status !== "active") {
        throw new UnauthorizedException("Admin account is unavailable");
      }

      request.adminUser = actor;
      request.adminSessionToken = token;
      request.adminSessionExpiresAt = payload.exp;
      request.adminSessionId = payload.sid;
      return true;
    } catch (error) {
      this.sessionService.clearSession(response);
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException("Invalid or expired admin session");
    }
  }
}
