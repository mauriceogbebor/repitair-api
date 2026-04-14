import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";

import { TokenBlacklistService } from "../services/token-blacklist.service";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly tokenBlacklist: TokenBlacklistService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing or invalid Authorization header");
    }

    const token = authHeader.slice(7);

    if (this.tokenBlacklist.isBlacklisted(token)) {
      throw new UnauthorizedException("Token has been revoked");
    }

    try {
      const payload = this.jwtService.verify(token);
      request.user = {
        sub: payload.sub,
        email: payload.email,
        token, // expose raw token so controllers (e.g. logout) can blacklist it
      };
      return true;
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }
  }
}
