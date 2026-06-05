import { Inject, Injectable, NestMiddleware, Optional } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";

import { REDIS_CLIENT } from "../modules/redis.module";
import { BaseRateLimiter } from "./base-rate-limit";

@Injectable()
export class RateLimitMiddleware extends BaseRateLimiter implements NestMiddleware {
  constructor(@Inject(REDIS_CLIENT) @Optional() redis: any | null) {
    super(
      {
        windowMs: 60 * 1000,
        maxRequests: 60,
        message: "Too many requests",
      },
      redis,
    );
  }

  use(req: Request, res: Response, next: NextFunction) {
    void this.check(req, res, next);
  }
}
