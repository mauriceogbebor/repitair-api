import { Inject, Injectable, NestMiddleware, Optional } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";

import { REDIS_CLIENT } from "../modules/redis.module";
import { BaseRateLimiter } from "./base-rate-limit";

/**
 * Stricter rate limiter for upload and image processing endpoints.
 * These are expensive operations (file I/O, image processing, S3 uploads)
 * so we limit to 15 requests per minute per IP (vs. the general 60/min).
 */
@Injectable()
export class UploadRateLimitMiddleware extends BaseRateLimiter implements NestMiddleware {
  constructor(@Inject(REDIS_CLIENT) @Optional() redis: any | null) {
    super(
      {
        windowMs: 60 * 1000,
        maxRequests: 15,
        message: "Too many upload requests. Please try again shortly.",
        keyExtractor: (req: Request) => {
          const ip = Array.isArray(req.ips) && req.ips.length > 0
            ? req.ips[0]
            : req.ip ?? req.socket.remoteAddress ?? "unknown";
          return `upload:${ip}`;
        },
      },
      redis,
    );
  }

  use(req: Request, res: Response, next: NextFunction) {
    void this.check(req, res, next);
  }
}
