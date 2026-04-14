import { Injectable, NestMiddleware, HttpException, HttpStatus } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";

type RateLimitEntry = { count: number; resetAt: number };

@Injectable()
export class AuthRateLimitMiddleware implements NestMiddleware {
  private readonly store = new Map<string, RateLimitEntry>();
  private readonly windowMs: number;
  private readonly maxRequests: number;

  constructor() {
    this.windowMs = 60 * 1000; // 1 minute window
    this.maxRequests = 10; // 10 requests per minute (stricter than general rate limit)
    // Cleanup stale entries every 5 minutes
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  use(req: Request, res: Response, next: NextFunction) {
    const key = this.getKey(req);
    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry || now > entry.resetAt) {
      this.store.set(key, { count: 1, resetAt: now + this.windowMs });
      this.setHeaders(res, this.maxRequests - 1, now + this.windowMs);
      return next();
    }

    entry.count++;

    if (entry.count > this.maxRequests) {
      this.setHeaders(res, 0, entry.resetAt);
      throw new HttpException("Too many authentication attempts", HttpStatus.TOO_MANY_REQUESTS);
    }

    this.setHeaders(res, this.maxRequests - entry.count, entry.resetAt);
    next();
  }

  private getKey(req: Request): string {
    // With `trust proxy` set in main.ts, req.ips[0] is the actual client.
    if (Array.isArray(req.ips) && req.ips.length > 0) return req.ips[0];
    return req.ip ?? req.socket.remoteAddress ?? "unknown";
  }

  private setHeaders(res: Response, remaining: number, resetAt: number) {
    res.setHeader("X-RateLimit-Limit", this.maxRequests);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, remaining));
    res.setHeader("X-RateLimit-Reset", Math.ceil(resetAt / 1000));
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.resetAt) this.store.delete(key);
    }
  }
}
