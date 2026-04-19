import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

type RedisClient = any; // Lazy-loaded to avoid build-time dependency

/**
 * Token blacklist — invalidates JWTs on logout.
 *
 * Supports both Redis (multi-instance) and in-memory Map (single-instance dev).
 * - If REDIS_URL env var is set, uses Redis with automatic TTL.
 * - Otherwise, falls back to in-memory Map with periodic cleanup.
 * - ioredis is lazy-loaded so builds don't break if not installed.
 */
@Injectable()
export class TokenBlacklistService {
  private readonly logger = new Logger(TokenBlacklistService.name);
  private redis: RedisClient | null = null;
  private readonly blacklist = new Map<string, number>(); // Fallback for in-memory mode
  private readonly cleanupIntervalMs = 60 * 60 * 1000; // 1 hour
  private readonly keyPrefix = "token:blacklist:";
  private isUsingRedis = false;

  constructor(private configService: ConfigService) {
    this.initializeRedis();

    // Only set up cleanup interval if using in-memory mode
    if (!this.isUsingRedis) {
      setInterval(() => this.cleanup(), this.cleanupIntervalMs).unref();
    }
  }

  private initializeRedis(): void {
    const redisUrl = this.configService.get<string>("REDIS_URL");

    if (!redisUrl) {
      this.logger.log(
        "Token blacklist using in-memory Map (REDIS_URL not set)",
      );
      this.isUsingRedis = false;
      return;
    }

    try {
      // Lazy-load ioredis to avoid build-time dependency
      let Redis: any;
      try {
        Redis = require("ioredis");
      } catch (e) {
        this.logger.warn(
          `ioredis not installed; falling back to in-memory token blacklist. ` +
            `Install ioredis to enable Redis support: npm install ioredis`,
        );
        this.isUsingRedis = false;
        return;
      }

      this.redis = new Redis(redisUrl);
      this.isUsingRedis = true;

      this.redis.on("error", (err: Error) => {
        this.logger.error(
          `Redis connection error (token blacklist will fall back to in-memory): ${err.message}`,
        );
        this.isUsingRedis = false;
      });

      this.redis.on("connect", () => {
        this.logger.log("Token blacklist connected to Redis");
      });
    } catch (error) {
      this.logger.warn(
        `Failed to initialize Redis for token blacklist; using in-memory: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      this.isUsingRedis = false;
    }
  }

  /**
   * Add a token to the blacklist. expiresAt is a unix timestamp (seconds).
   * If omitted, falls back to 7 days from now (matches JWT signOptions).
   */
  async add(token: string, expiresAt?: number): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const expiry = expiresAt ?? now + 7 * 24 * 60 * 60;
    const ttl = Math.max(1, expiry - now); // Ensure TTL is at least 1 second

    if (this.isUsingRedis && this.redis) {
      try {
        const key = this.keyPrefix + token;
        await this.redis.setex(key, ttl, "1");
      } catch (error) {
        this.logger.error(
          `Failed to add token to Redis blacklist; falling back to in-memory: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        this.blacklist.set(token, expiry);
      }
    } else {
      this.blacklist.set(token, expiry);
    }
  }

  async isBlacklisted(token: string): Promise<boolean> {
    if (this.isUsingRedis && this.redis) {
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

    // In-memory check
    const expiry = this.blacklist.get(token);
    if (!expiry) return false;

    // If the token has expired anyway, remove it and treat as not blacklisted
    // (it's already invalid by signature, so blacklist membership is moot).
    if (Math.floor(Date.now() / 1000) > expiry) {
      this.blacklist.delete(token);
      return false;
    }

    return true;
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

  /**
   * Graceful shutdown — close Redis connection if in use.
   */
  async onModuleDestroy(): Promise<void> {
    if (this.isUsingRedis && this.redis) {
      try {
        await this.redis.quit();
        this.logger.log("Token blacklist Redis connection closed");
      } catch (error) {
        this.logger.error(
          `Error closing Redis connection: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
}
