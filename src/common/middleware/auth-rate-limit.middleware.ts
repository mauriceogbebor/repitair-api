import { Inject, Injectable, NestMiddleware, Optional } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";

import { REDIS_CLIENT } from "../modules/redis.module";
import { BaseRateLimiter } from "./base-rate-limit";

@Injectable()
export class AuthRateLimitMiddleware extends BaseRateLimiter implements NestMiddleware {
  constructor(@Inject(REDIS_CLIENT) @Optional() redis: any | null) {
    super(
      {
        windowMs: 60 * 1000,
        maxRequests: 10,
        message: "Too many authentication attempts",
      },
      redis,
    );
  }

  use(req: Request, res: Response, next: NextFunction): Promise<void> {
    return this.check(req, res, next);
  }
}
