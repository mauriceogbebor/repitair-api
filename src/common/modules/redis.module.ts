import { Module, Global, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * Injection token for the shared Redis client.
 * Inject with `@Inject(REDIS_CLIENT)`. The value is the ioredis instance
 * or `null` when Redis is not configured. A configured client can be in a
 * reconnecting state, so consumers must also check `isRedisReady` before
 * issuing commands and fall back to in-memory storage while it recovers.
 */
export const REDIS_CLIENT = Symbol("REDIS_CLIENT");

type RedisClient = any; // Lazy-loaded to avoid build-time dependency

export function isRedisReady(client: RedisClient | null | undefined): boolean {
  if (!client) return false;

  // ioredis always exposes `status`. Allow status-less test doubles so callers
  // can continue to use lightweight Redis mocks.
  return client.status === undefined || client.status === "ready";
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (config: ConfigService): RedisClient | null => {
        const logger = new Logger("RedisModule");
        const redisUrl = config.get<string>("REDIS_URL");

        if (!redisUrl) {
          logger.log("REDIS_URL not set — Redis features will use in-memory fallbacks");
          return null;
        }

        let Redis: any;
        try {
          Redis = require("ioredis");
        } catch {
          logger.warn(
            "ioredis not installed — Redis features will use in-memory fallbacks. " +
              "Install ioredis to enable Redis: npm install ioredis",
          );
          return null;
        }

        let client: RedisClient | null = null;
        let hasLoggedFailure = false;

        try {
          client = new Redis(redisUrl, {
            connectTimeout: 5000,
            enableOfflineQueue: false,
            lazyConnect: true,
            maxRetriesPerRequest: 1,
            retryStrategy: (attempt: number) =>
              Math.min(500 * 2 ** Math.min(Math.max(attempt - 1, 0), 6), 30_000),
          });

          client.on("error", (err: Error) => {
            if (!hasLoggedFailure) {
              logger.error(`Redis connection error: ${err.message}`);
              hasLoggedFailure = true;
            }
          });

          client.on("ready", () => {
            logger.log(hasLoggedFailure ? "Redis connection restored" : "Redis connected");
            hasLoggedFailure = false;
          });

          void client.connect().catch((err: Error) => {
            if (!hasLoggedFailure) {
              logger.error(`Redis connection error: ${err.message}`);
              hasLoggedFailure = true;
            }
          });
        } catch (error) {
          logger.warn(
            `Failed to initialize Redis: ${error instanceof Error ? error.message : String(error)}`,
          );
          return null;
        }

        return client;
      },
      inject: [ConfigService],
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
