import { Injectable, Logger } from "@nestjs/common";

/**
 * Token blacklist — invalidates JWTs on logout.
 *
 * In-memory implementation for MVP / single-instance deploys.
 * For multi-instance / production scale, swap the Map for Redis
 * (same interface, zero call-site changes).
 */
@Injectable()
export class TokenBlacklistService {
  private readonly logger = new Logger(TokenBlacklistService.name);
  private readonly blacklist = new Map<string, number>();
  private readonly cleanupIntervalMs = 60 * 60 * 1000; // 1 hour

  constructor() {
    setInterval(() => this.cleanup(), this.cleanupIntervalMs).unref();
  }

  /**
   * Add a token to the blacklist. expiresAt is a unix timestamp (seconds).
   * If omitted, falls back to 7 days from now (matches JWT signOptions).
   */
  add(token: string, expiresAt?: number): void {
    const expiry = expiresAt ?? Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
    this.blacklist.set(token, expiry);
  }

  isBlacklisted(token: string): boolean {
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
}
