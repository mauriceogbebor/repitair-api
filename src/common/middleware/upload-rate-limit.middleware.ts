import { createHash } from "crypto";

import { Inject, Injectable, NestMiddleware, Optional } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";

import { REDIS_CLIENT } from "../modules/redis.module";
import { BaseRateLimiter } from "./base-rate-limit";

/**
 * Extract the `sub` claim from a JWT WITHOUT verifying its signature.
 * Used only for rate-limit bucketing — the JwtAuthGuard that runs after
 * this middleware performs full verification, so an invalid/forged token
 * is rejected before it can consume a successful upload. Returns null for
 * any malformed input (caller falls back to a token hash).
 */
function extractJwtSubject(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    ) as { sub?: unknown };
    return typeof payload.sub === "string" && payload.sub.length > 0 ? payload.sub : null;
  } catch {
    return null;
  }
}

/**
 * Stricter rate limiter for upload and image processing endpoints.
 * These are expensive operations (file I/O, image processing, S3 uploads)
 * so we limit to 15 requests per minute per IP (vs. the general 60/min).
 */
@Injectable()
export class UploadRateLimitMiddleware extends BaseRateLimiter implements NestMiddleware {
  constructor(@Inject(REDIS_CLIENT) @Optional() redis: any | null) {
    super(
      {
        windowMs: 60 * 1000,
        maxRequests: 15,
        message: "Too many upload requests. Please try again shortly.",
        keyExtractor: (req: Request) => {
          // Uploads are authenticated. Key the budget per-user so testers/
          // users behind carrier-grade NAT do NOT share one IP bucket — the
          // cause of "uploads fail after several Repits" when multiple
          // sessions share an egress IP.
          //
          // NOTE ON ORDERING: NestJS middleware runs BEFORE guards, so the
          // verified `req.user` (set by JwtAuthGuard) is not available here.
          // We therefore read the `sub` claim directly from the JWT payload.
          // This is a bucketing key, not a security boundary: a token with a
          // forged `sub` is rejected by the guard that runs immediately after,
          // so it can never consume a *successful* upload. Keying on `sub`
          // (rather than a hash of the whole token) means the bucket is stable
          // across token refresh — the same user always maps to one bucket.
          const auth = req.headers.authorization;
          if (auth?.startsWith("Bearer ")) {
            const sub = extractJwtSubject(auth.slice(7));
            if (sub) return `upload:user:${sub}`;
            // Malformed token — fall back to a stable hash so we still bucket.
            const digest = createHash("sha256").update(auth).digest("hex").slice(0, 16);
            return `upload:token:${digest}`;
          }
          const ip = Array.isArray(req.ips) && req.ips.length > 0
            ? req.ips[0]
            : req.ip ?? req.socket.remoteAddress ?? "unknown";
          return `upload:ip:${ip}`;
        },
      },
      redis,
    );
  }

  use(req: Request, res: Response, next: NextFunction) {
    void this.check(req, res, next);
  }
}
