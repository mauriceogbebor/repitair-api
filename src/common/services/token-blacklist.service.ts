import { Inject, Injectable, Logger, Optional } from "@nestjs/common";

import { isRedisReady, REDIS_CLIENT } from "../modules/redis.module";

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
  private hasLoggedRedisFailure = false;

  constructor(
    @Inject(REDIS_CLIENT) @Optional() private readonly redis: RedisClient | null,
  ) {
    if (this.redis) {
      this.logger.log("Token blacklist configured for Redis with in-memory fallback");
    } else {
      this.logger.log("Token blacklist using in-memory Map");
    }
    this.ensureCleanupInterval();
  }

  /**
   * Add a token to the blacklist. expiresAt is a unix timestamp (seconds).
   * If omitted, falls back to 7 days from now (matches JWT signOptions).
   */
  async add(token: string, expiresAt?: number): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const expiry = expiresAt ?? now + 7 * 24 * 60 * 60;
    if (expiry <= now) {
      this.blacklist.delete(token);
      return;
    }

    const ttl = expiry - now;

    // Mirror revocations locally even when Redis is healthy. If Redis becomes
    // unavailable later, this process must not temporarily accept a token it
    // already revoked.
    this.blacklist.set(token, expiry);

    if (isRedisReady(this.redis)) {
      try {
        const key = this.keyPrefix + token;
        await this.redis.setex(key, ttl, "1");
        this.hasLoggedRedisFailure = false;
      } catch (error) {
        this.logRedisFailure("add token to", error);
      }
    }
  }

  async isBlacklisted(token: string): Promise<boolean> {
    const locallyBlacklisted = this.isLocallyBlacklisted(token);

    if (isRedisReady(this.redis)) {
      try {
        const key = this.keyPrefix + token;
        const exists = await this.redis.exists(key);
        this.hasLoggedRedisFailure = false;
        return exists === 1 || locallyBlacklisted;
      } catch (error) {
        this.logRedisFailure("check", error);
      }
    }

    return locallyBlacklisted;
  }

  private isLocallyBlacklisted(token: string): boolean {
    const expiry = this.blacklist.get(token);
    if (!expiry) return false;

    if (Math.floor(Date.now() / 1000) > expiry) {
      this.blacklist.delete(token);
      return false;
    }

    return true;
  }

  private logRedisFailure(action: string, error: unknown): void {
    if (this.hasLoggedRedisFailure) return;

    this.logger.error(
      `Failed to ${action} Redis blacklist; falling back to in-memory: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    this.hasLoggedRedisFailure = true;
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
