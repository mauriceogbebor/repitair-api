import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";

import { TokenBlacklistService } from "../services/token-blacklist.service";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly tokenBlacklist: TokenBlacklistService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      throw new UnauthorizedException({
        errorCode: "SESSION_INVALID",
        message: "Missing or invalid Authorization header",
        retriable: false,
      });
    }

    const token = authHeader.slice(7);

    try {
      const payload = this.jwtService.verify(token);

      // Check blacklist using jti (compact) or full token (pre-jti backwards compat)
      const blacklistKey = payload.jti ?? token;
      if (await this.tokenBlacklist.isBlacklisted(blacklistKey)) {
        throw new UnauthorizedException({
          errorCode: "SESSION_INVALID",
          message: "Token has been revoked",
          retriable: false,
        });
      }

      request.user = {
        sub: payload.sub,
        email: payload.email,
        token, // expose raw token so controllers (e.g. logout) can blacklist it
      };
      return true;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      const expired = err instanceof Error && err.name === "TokenExpiredError";
      throw new UnauthorizedException({
        errorCode: expired ? "ACCESS_TOKEN_EXPIRED" : "SESSION_INVALID",
        message: expired ? "Access token expired" : "Invalid access token",
        retriable: expired,
      });
    }
  }
}
