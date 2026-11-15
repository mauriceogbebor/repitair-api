import { Inject, Injectable, NestMiddleware, Optional } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Request, Response, NextFunction } from "express";

import { REDIS_CLIENT } from "../modules/redis.module";
import { BaseRateLimiter } from "./base-rate-limit";

/**
 * Rate limiter for the lyrics proxy. Each request triggers an upstream LRCLIB
 * call, so we cap it at 30 requests per minute per authenticated user (anonymous
 * lookups fall back to an IP budget).
 */
@Injectable()
export class LyricsRateLimitMiddleware extends BaseRateLimiter implements NestMiddleware {
  constructor(
    @Inject(REDIS_CLIENT) @Optional() redis: any | null,
    jwt: JwtService,
  ) {
    super(
      {
        windowMs: 60 * 1000,
        maxRequests: 30,
        message: "Too many lyrics requests. Please try again shortly.",
        keyExtractor: (req: Request) => BaseRateLimiter.authenticatedOrIpKey(
          req,
          "lyrics",
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
