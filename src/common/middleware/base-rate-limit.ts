import { HttpException, HttpStatus, Logger, OnModuleDestroy } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";

import { isRedisReady } from "../modules/redis.module";

type RateLimitEntry = { count: number; resetAt: number };

export type RateLimitConfig = {
  /** Window duration in milliseconds */
  windowMs: number;
  /** Maximum requests allowed per window */
  maxRequests: number;
  /** Error message when limit is exceeded */
  message: string;
  /** Whether to send X-RateLimit-* response headers */
  sendHeaders?: boolean;
  /** Extract the rate-limit key from the request. Defaults to client IP. */
  keyExtractor?: (req: Request) => string | null;
};

/**
 * Shared rate-limit logic with optional Redis backing.
 *
 * When a Redis client is provided, counters are stored in Redis so limits
 * are enforced across all server instances. Falls back to an in-memory Map
 * when Redis is unavailable or errors.
 *
 * Subclasses only need to call `super(config, redis)` and implement
 * NestMiddleware.use by delegating to `this.check(req, res, next)`.
 */
export abstract class BaseRateLimiter implements OnModuleDestroy {
  protected readonly logger = new Logger(this.constructor.name);
  private readonly store = new Map<string, RateLimitEntry>();
  private readonly cleanupInterval: NodeJS.Timeout;
  private readonly keyPrefix: string;
  private hasLoggedRedisFailure = false;

  constructor(
    protected readonly config: RateLimitConfig,
    private readonly redis: any | null = null,
  ) {
    this.keyPrefix = `ratelimit:${this.constructor.name}:`;
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    this.cleanupInterval.unref();
  }

  onModuleDestroy() {
    clearInterval(this.cleanupInterval);
  }

  protected async check(req: Request, res: Response, next: NextFunction): Promise<void> {
    const keyExtractor = this.config.keyExtractor ?? BaseRateLimiter.defaultKeyExtractor;
    const rawKey = keyExtractor(req);
    if (rawKey === null) {
      // Key extractor returned null — skip rate limiting (e.g. missing email)
      return next();
    }

    const { windowMs, maxRequests, message, sendHeaders = true } = this.config;

    // Try Redis first
    if (isRedisReady(this.redis)) {
      try {
        const redisKey = this.keyPrefix + rawKey;
        const current = await this.redis.incr(redisKey);
        if (current === 1) {
          await this.redis.pexpire(redisKey, windowMs);
        }

        const ttl = await this.redis.pttl(redisKey);
        const resetAt = Date.now() + Math.max(ttl, 0);
        this.hasLoggedRedisFailure = false;

        if (current > maxRequests) {
          if (sendHeaders) this.setHeaders(res, maxRequests, 0, resetAt);
          throw new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
        }

        if (sendHeaders) this.setHeaders(res, maxRequests, maxRequests - current, resetAt);
        return next();
      } catch (err) {
        if (err instanceof HttpException) throw err;
        if (!this.hasLoggedRedisFailure) {
          this.logger.error(
            `Redis rate-limit error, falling back to in-memory: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          this.hasLoggedRedisFailure = true;
        }
        // Fall through to in-memory
      }
    }

    // In-memory fallback
    const now = Date.now();
    const entry = this.store.get(rawKey);

    if (!entry || now > entry.resetAt) {
      this.store.set(rawKey, { count: 1, resetAt: now + windowMs });
      if (sendHeaders) this.setHeaders(res, maxRequests, maxRequests - 1, now + windowMs);
      return next();
    }

    entry.count++;

    if (entry.count > maxRequests) {
      if (sendHeaders) this.setHeaders(res, maxRequests, 0, entry.resetAt);
      throw new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
    }

    if (sendHeaders) this.setHeaders(res, maxRequests, maxRequests - entry.count, entry.resetAt);
    next();
  }

  private setHeaders(res: Response, limit: number, remaining: number, resetAt: number) {
    res.setHeader("X-RateLimit-Limit", limit);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, remaining));
    res.setHeader("X-RateLimit-Reset", Math.ceil(resetAt / 1000));
  }

  private cleanup() {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.store) {
      if (now > entry.resetAt) {
        this.store.delete(key);
        removed++;
      }
    }
    if (removed > 0) {
      this.logger.debug(`Cleaned up ${removed} expired rate-limit entries`);
    }
  }

  static defaultKeyExtractor(req: Request): string {
    if (Array.isArray(req.ips) && req.ips.length > 0) return req.ips[0];
    return req.ip ?? req.socket.remoteAddress ?? "unknown";
  }
}
