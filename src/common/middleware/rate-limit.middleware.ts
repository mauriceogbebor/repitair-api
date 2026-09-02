import { Inject, Injectable, NestMiddleware, Optional } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Request, Response, NextFunction } from "express";

import { REDIS_CLIENT } from "../modules/redis.module";
import { BaseRateLimiter } from "./base-rate-limit";

@Injectable()
export class RateLimitMiddleware extends BaseRateLimiter implements NestMiddleware {
  constructor(
    @Inject(REDIS_CLIENT) @Optional() redis: any | null,
    jwt: JwtService,
  ) {
    super(
      {
        windowMs: 60 * 1000,
        maxRequests: 60,
        message: "Too many requests",
        keyExtractor: (req: Request) => BaseRateLimiter.authenticatedOrIpKey(
          req,
          "general",
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
