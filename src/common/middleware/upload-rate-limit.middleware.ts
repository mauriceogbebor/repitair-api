import { Injectable, NestMiddleware, HttpException, HttpStatus } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";

type RateLimitEntry = { count: number; resetAt: number };

/**
 * Stricter rate limiter for upload and image processing endpoints.
 * These are expensive operations (file I/O, image processing, S3 uploads)
 * so we limit to 15 requests per minute per IP (vs. the general 60/min).
 */
@Injectable()
export class UploadRateLimitMiddleware implements NestMiddleware {
  private readonly store = new Map<string, RateLimitEntry>();
  private readonly windowMs = 60 * 1000; // 1 minute window
  private readonly maxRequests = 15; // 15 uploads per minute

  constructor() {
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
      throw new HttpException(
        "Too many upload requests. Please try again shortly.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    this.setHeaders(res, this.maxRequests - entry.count, entry.resetAt);
    next();
  }

  private getKey(req: Request): string {
    if (Array.isArray(req.ips) && req.ips.length > 0) return `upload:${req.ips[0]}`;
    return `upload:${req.ip ?? req.socket.remoteAddress ?? "unknown"}`;
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
