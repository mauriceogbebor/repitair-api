import { Inject, Injectable, NestMiddleware, Optional } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Request, Response, NextFunction } from "express";

import { REDIS_CLIENT } from "../modules/redis.module";
import { BaseRateLimiter } from "./base-rate-limit";

/**
 * Rate limiter for music endpoints (parse-link, search).
 * Each request triggers upstream API calls to Spotify/Apple Music,
 * so we limit to 30 requests per minute per authenticated user. Anonymous
 * lookups retain an IP budget.
 */
@Injectable()
export class MusicRateLimitMiddleware extends BaseRateLimiter implements NestMiddleware {
  constructor(
    @Inject(REDIS_CLIENT) @Optional() redis: any | null,
    jwt: JwtService,
  ) {
    super(
      {
        windowMs: 60 * 1000,
        maxRequests: 30,
        message: "Too many music requests. Please try again shortly.",
        keyExtractor: (req: Request) => BaseRateLimiter.authenticatedOrIpKey(
          req,
          "music",
          (token) => jwt.verify(token),
        ),
      },
      redis,
    );
  }

  use(req: Request, res: Response, next: NextFunction): Promise<void> {
    return this.check(req, res, next);
  }
}
