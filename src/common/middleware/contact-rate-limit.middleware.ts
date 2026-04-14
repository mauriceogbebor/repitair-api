import { Injectable, NestMiddleware, HttpException, HttpStatus } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";

type RateLimitEntry = { count: number; resetAt: number };

/**
 * Contact form rate limit: 3 submissions per hour per IP.
 * Prevents the landing-page form from being used as an anonymous
 * mailer to the support inbox.
 */
@Injectable()
export class ContactRateLimitMiddleware implements NestMiddleware {
  private readonly store = new Map<string, RateLimitEntry>();
  private readonly windowMs = 60 * 60 * 1000; // 1 hour
  private readonly maxRequests = 3;

  constructor() {
    setInterval(() => this.cleanup(), 10 * 60 * 1000).unref();
  }

  use(req: Request, _res: Response, next: NextFunction) {
    const key = this.getKey(req);
    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry || now > entry.resetAt) {
      this.store.set(key, { count: 1, resetAt: now + this.windowMs });
      return next();
    }

    entry.count++;

    if (entry.count > this.maxRequests) {
      throw new HttpException(
        "Too many contact submissions — try again later.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    next();
  }

  private getKey(req: Request): string {
    if (Array.isArray(req.ips) && req.ips.length > 0) return req.ips[0];
    return req.ip ?? req.socket.remoteAddress ?? "unknown";
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.resetAt) this.store.delete(key);
    }
  }
}
