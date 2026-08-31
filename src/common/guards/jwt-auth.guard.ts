import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import { User } from "../../entities";
import { TokenBlacklistService } from "../services/token-blacklist.service";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly tokenBlacklist: TokenBlacklistService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
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

      const user = await this.userRepository.findOne({
        where: { id: payload.sub },
        select: { id: true, email: true, isSuspended: true, sessionVersion: true },
      });
      if (!user || user.isSuspended || (payload.sessionVersion ?? 0) !== (user.sessionVersion ?? 0)) {
        throw new UnauthorizedException({
          errorCode: user?.isSuspended ? "ACCOUNT_DISABLED" : "SESSION_INVALID",
          message: user?.isSuspended ? "This account is unavailable" : "This session has been revoked",
          retriable: false,
        });
      }

      request.user = {
        sub: payload.sub,
        email: user.email,
        authTime: typeof payload.authTime === "number" ? payload.authTime : undefined,
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
