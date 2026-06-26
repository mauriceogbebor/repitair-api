import { Inject, Injectable, NestMiddleware, Optional } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";

import { REDIS_CLIENT } from "../modules/redis.module";
import { BaseRateLimiter } from "./base-rate-limit";

/**
 * Rate limiter for music endpoints (parse-link, search).
 * Each request triggers upstream API calls to Spotify/Apple Music,
 * so we limit to 30 requests per minute per IP.
 */
@Injectable()
export class MusicRateLimitMiddleware extends BaseRateLimiter implements NestMiddleware {
  constructor(@Inject(REDIS_CLIENT) @Optional() redis: any | null) {
    super(
      {
        windowMs: 60 * 1000,
        maxRequests: 30,
        message: "Too many music requests. Please try again shortly.",
        keyExtractor: (req: Request) => {
          const ip = Array.isArray(req.ips) && req.ips.length > 0
            ? req.ips[0]
            : req.ip ?? req.socket.remoteAddress ?? "unknown";
          return `music:${ip}`;
        },
      },
      redis,
    );
  }

  use(req: Request, res: Response, next: NextFunction) {
    void this.check(req, res, next);
  }
}
