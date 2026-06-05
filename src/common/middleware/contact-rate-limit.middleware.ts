import { Inject, Injectable, NestMiddleware, Optional } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";

import { REDIS_CLIENT } from "../modules/redis.module";
import { BaseRateLimiter } from "./base-rate-limit";

/**
 * Contact form rate limit: 3 submissions per hour per IP.
 * Prevents the landing-page form from being used as an anonymous
 * mailer to the support inbox.
 */
@Injectable()
export class ContactRateLimitMiddleware extends BaseRateLimiter implements NestMiddleware {
  constructor(@Inject(REDIS_CLIENT) @Optional() redis: any | null) {
    super(
      {
        windowMs: 60 * 60 * 1000,
        maxRequests: 3,
        message: "Too many contact submissions — try again later.",
        sendHeaders: false,
      },
      redis,
    );
  }

  use(req: Request, res: Response, next: NextFunction) {
    void this.check(req, res, next);
  }
}
