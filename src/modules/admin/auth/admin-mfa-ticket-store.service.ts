import { Inject, Injectable, Optional, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { isRedisReady, REDIS_CLIENT } from "../../../common/modules/redis.module";
import type { AdminMfaTicketPayload } from "./admin-token.service";

@Injectable()
export class AdminMfaTicketStoreService {
  private readonly consumedLocally = new Map<string, number>();

  constructor(
    @Inject(REDIS_CLIENT) @Optional() private readonly redis: any | null,
    private readonly configService: ConfigService,
  ) {}

  async consume(payload: AdminMfaTicketPayload): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const ttlSeconds = Math.max((payload.exp ?? now) - now, 1);
    const key = `admin:mfa-ticket:consumed:${payload.jti}`;

    if (isRedisReady(this.redis)) {
      let result: string | null;
      try {
        result = await this.redis.set(key, "1", "EX", ttlSeconds, "NX");
      } catch {
        throw new ServiceUnavailableException("MFA verification is temporarily unavailable");
      }
      if (result !== "OK") throw new UnauthorizedException("MFA challenge has already been used");
      return;
    }

    if (this.redis || this.configService.get<string>("NODE_ENV") === "production") {
      throw new ServiceUnavailableException("MFA verification is temporarily unavailable");
    }

    this.pruneLocal(now);
    if (this.consumedLocally.has(payload.jti)) {
      throw new UnauthorizedException("MFA challenge has already been used");
    }
    this.consumedLocally.set(payload.jti, now + ttlSeconds);
  }

  private pruneLocal(now: number): void {
    for (const [ticketId, expiresAt] of this.consumedLocally) {
      if (expiresAt <= now) this.consumedLocally.delete(ticketId);
    }
  }
}
