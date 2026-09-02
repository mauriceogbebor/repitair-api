import { Inject, Injectable, NestMiddleware, Optional } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Request, Response, NextFunction } from "express";

import { REDIS_CLIENT } from "../modules/redis.module";
import { BaseRateLimiter } from "./base-rate-limit";

/**
 * Stricter rate limiter for upload and image processing endpoints.
 * These are expensive operations (file I/O, image processing, S3 uploads)
 * so authenticated users are limited to 15 requests per minute (vs. the
 * general 60/min). Anonymous requests fall back to an IP bucket.
 */
@Injectable()
export class UploadRateLimitMiddleware extends BaseRateLimiter implements NestMiddleware {
  constructor(
    @Inject(REDIS_CLIENT) @Optional() redis: any | null,
    jwt: JwtService,
  ) {
    super(
      {
        windowMs: 60 * 1000,
        maxRequests: 15,
        message: "Too many upload requests. Please try again shortly.",
        keyExtractor: (req: Request) => BaseRateLimiter.authenticatedOrIpKey(
          req,
          "upload",
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
