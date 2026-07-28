import { Inject, Injectable, NestMiddleware, Optional } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";

import { REDIS_CLIENT } from "../modules/redis.module";
import { BaseRateLimiter } from "./base-rate-limit";

/**
 * Per-email rate limit for password reset code verification.
 *
 * With a 6-digit code (1M combinations) and a 10-minute code lifetime,
 * we cap attempts to 5 per 10 minutes per email. This keeps brute-force
 * success probability under 0.0005% per reset request.
 */
@Injectable()
export class VerifyCodeRateLimitMiddleware extends BaseRateLimiter implements NestMiddleware {
  constructor(@Inject(REDIS_CLIENT) @Optional() redis: any | null) {
    super(
      {
        windowMs: 10 * 60 * 1000,
        maxRequests: 5,
        message: "Too many verification attempts. Request a new code.",
        sendHeaders: false,
        keyExtractor: (req: Request) => {
          const body = req.body as { email?: unknown } | undefined;
          const email = typeof body?.email === "string" ? body.email : null;
          return email ? `verify:${email.toLowerCase()}` : null;
        },
      },
      redis,
    );
  }

  use(req: Request, res: Response, next: NextFunction): Promise<void> {
    return this.check(req, res, next);
  }
}
