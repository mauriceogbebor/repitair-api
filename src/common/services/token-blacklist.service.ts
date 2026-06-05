import { Inject, Injectable, Logger, Optional } from "@nestjs/common";

import { REDIS_CLIENT } from "../modules/redis.module";

type RedisClient = any;

/**
 * Token blacklist — invalidates JWTs on logout.
 *
 * Uses the shared Redis client (from RedisModule) when available, otherwise
 * falls back to an in-memory Map with periodic cleanup.
 */
@Injectable()
export class TokenBlacklistService {
  private readonly logger = new Logger(TokenBlacklistService.name);
  private readonly blacklist = new Map<string, number>(); // In-memory fallback
  private readonly cleanupIntervalMs = 60 * 60 * 1000; // 1 hour
  private readonly keyPrefix = "token:blacklist:";
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(
    @Inject(REDIS_CLIENT) @Optional() private readonly redis: RedisClient | null,
  ) {
    if (this.redis) {
      this.logger.log("Token blacklist using Redis");
    } else {
      this.logger.log("Token blacklist using in-memory Map");
      this.ensureCleanupInterval();
    }
  }

  /**
   * Add a token to the blacklist. expiresAt is a unix timestamp (seconds).
   * If omitted, falls back to 7 days from now (matches JWT signOptions).
   */
  async add(token: string, expiresAt?: number): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const expiry = expiresAt ?? now + 7 * 24 * 60 * 60;
    const ttl = Math.max(1, expiry - now);

    if (this.redis) {
      try {
        const key = this.keyPrefix + token;
        await this.redis.setex(key, ttl, "1");
        return;
      } catch (error) {
        this.logger.error(
          `Failed to add token to Redis blacklist; falling back to in-memory: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    this.ensureCleanupInterval();
    this.blacklist.set(token, expiry);
  }

  async isBlacklisted(token: string): Promise<boolean> {
    if (this.redis) {
      try {
        const key = this.keyPrefix + token;
        const exists = await this.redis.exists(key);
        return exists === 1;
      } catch (error) {
        this.logger.error(
          `Failed to check Redis blacklist; falling back to in-memory: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        // Fall through to in-memory check
      }
    }

    const expiry = this.blacklist.get(token);
    if (!expiry) return false;

    if (Math.floor(Date.now() / 1000) > expiry) {
      this.blacklist.delete(token);
      return false;
    }

    return true;
  }

  private ensureCleanupInterval(): void {
    if (this.cleanupInterval) return;

    this.cleanupInterval = setInterval(() => this.cleanup(), this.cleanupIntervalMs);
    this.cleanupInterval.unref();
  }

  private cleanup(): void {
    const now = Math.floor(Date.now() / 1000);
    let removed = 0;
    for (const [token, expiry] of this.blacklist) {
      if (now > expiry) {
        this.blacklist.delete(token);
        removed++;
      }
    }
    if (removed > 0) {
      this.logger.debug(`Cleaned up ${removed} expired blacklisted tokens`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}
