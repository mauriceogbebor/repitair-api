import { Injectable, NestMiddleware, HttpException, HttpStatus } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";

type RateLimitEntry = { count: number; resetAt: number };

/**
 * Per-email rate limit for password reset code verification.
 *
 * With a 6-digit code (1M combinations) and a 10-minute code lifetime,
 * we cap attempts to 5 per 10 minutes per email. This keeps brute-force
 * success probability under 0.0005% per reset request.
 */
@Injectable()
export class VerifyCodeRateLimitMiddleware implements NestMiddleware {
  private readonly store = new Map<string, RateLimitEntry>();
  private readonly windowMs = 10 * 60 * 1000; // 10 minutes (matches code expiry)
  private readonly maxAttempts = 5;

  constructor() {
    setInterval(() => this.cleanup(), 5 * 60 * 1000).unref();
  }

  use(req: Request, res: Response, next: NextFunction) {
    const email = this.extractEmail(req);
    if (!email) {
      // No email means body validation will reject it — skip rate limit.
      return next();
    }

    const key = `verify:${email.toLowerCase()}`;
    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry || now > entry.resetAt) {
      this.store.set(key, { count: 1, resetAt: now + this.windowMs });
      return next();
    }

    entry.count++;

    if (entry.count > this.maxAttempts) {
      throw new HttpException(
        "Too many verification attempts. Request a new code.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    next();
  }

  private extractEmail(req: Request): string | null {
    const body = req.body as { email?: unknown } | undefined;
    return typeof body?.email === "string" ? body.email : null;
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.resetAt) this.store.delete(key);
    }
  }
}
