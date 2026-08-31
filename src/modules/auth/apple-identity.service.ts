import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createPublicKey } from "crypto";
import {
  verify as verifyJwt,
  JsonWebTokenError,
  TokenExpiredError,
  NotBeforeError,
} from "jsonwebtoken";

/**
 * Verifies "Sign in with Apple" identity tokens.
 *
 * These tokens are ordinary RS256 JWTs signed by Apple's private keys and must
 * be verified against Apple's public keys, published as a JWKS at
 * https://appleid.apple.com/auth/keys. This is completely separate from Apple
 * Music: it never touches the MusicKit developer token, the Apple Music private
 * key, or a Music User Token. Those credentials sign/authorize Apple Music
 * requests and are meaningless for identity-token verification.
 *
 * Historic bug this replaces: verification was routed through NestJS
 * `JwtService.verify`, whose key is resolved from the *module-level* options
 * (the symmetric `JWT_SECRET`), so the per-call Apple public key was ignored and
 * jsonwebtoken threw "secretOrPublicKey must be an asymmetric key when using
 * RS256". Verification now uses the `jsonwebtoken` library directly with the
 * fetched Apple public key.
 */

const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";
const APPLE_ISSUER = "https://appleid.apple.com";
/** How long a fetched JWKS is trusted before a refresh is required. */
const JWKS_CACHE_TTL_MS = 10 * 60 * 1000;
/** Bounded network timeout so a hung Apple endpoint can't stall logins. */
const JWKS_FETCH_TIMEOUT_MS = 5000;

interface AppleJwk {
  kid: string;
  kty: string;
  use?: string;
  alg?: string;
  n: string;
  e: string;
}

interface AppleTokenHeader {
  kid?: string;
  alg?: string;
}

export interface AppleIdentity {
  email: string;
  sub: string;
  /**
   * Whether Apple asserts the email is verified. Apple sends `email_verified`
   * as the string "true"/"false" (occasionally a boolean). Used by identity
   * linking to refuse merging a provider identity into an unverified local
   * account (account pre-hijacking defense).
   */
  emailVerified: boolean;
  exp?: number;
}

/**
 * Internal, typed verification failure. Carries a safe `code` for structured
 * logging; the message is never surfaced verbatim to the client.
 */
export class AppleTokenError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppleTokenError";
  }
}

@Injectable()
export class AppleIdentityService {
  private readonly logger = new Logger(AppleIdentityService.name);

  /** kid -> SPKI PEM public key, plus when the set was fetched. */
  private jwksCache: { keys: Map<string, string>; fetchedAt: number } | null =
    null;
  /** De-dupes concurrent JWKS fetches so a login burst triggers one request. */
  private inflightFetch: Promise<Map<string, string>> | null = null;

  constructor(private readonly configService: ConfigService) {}

  /**
   * The set of audiences (`aud`) we accept. Apple sets `aud` to the client that
   * requested the token — the iOS bundle identifier for native Sign in with
   * Apple, or the Services ID for the web flow. Supporting multiple avoids
   * locking out a legitimate client, while still rejecting unknown audiences.
   */
  private getAllowedAudiences(): string[] {
    const configured = [
      this.configService.get<string>("APPLE_CLIENT_ID"),
      this.configService.get<string>("APPLE_SERVICE_ID"),
      this.configService.get<string>("APPLE_BUNDLE_ID"),
      ...(this.configService.get<string>("APPLE_ALLOWED_AUDIENCES")?.split(",") ??
        []),
    ];
    return [
      ...new Set(
        configured
          .map((value) => value?.trim())
          .filter((value): value is string => Boolean(value)),
      ),
    ];
  }

  /**
   * Verify an Apple identity token and return the identity claims.
   *
   * @throws ServiceUnavailableException when Apple Sign In is not configured.
   * @throws UnauthorizedException (generic) for every verification failure.
   */
  async verifyIdentityToken(
    idToken: string,
    options?: { expectedNonce?: string; requireNonce?: boolean },
  ): Promise<AppleIdentity> {
    const audiences = this.getAllowedAudiences();
    if (audiences.length === 0) {
      // Fail closed, and do not reach out to Apple, when unconfigured.
      throw new ServiceUnavailableException(
        "Apple Sign In is not available. APPLE_CLIENT_ID must be configured.",
      );
    }

    let safeKid: string | undefined;
    let safeAlg: string | undefined;

    try {
      const header = this.decodeHeader(idToken);
      safeKid = header.kid;
      safeAlg = header.alg;

      // Pin the algorithm. Apple signs identity tokens with RS256; accepting the
      // token's self-declared algorithm would open an algorithm-confusion hole.
      if (header.alg !== "RS256") {
        throw new AppleTokenError(
          "unsupported_algorithm",
          `Unsupported token algorithm: ${header.alg ?? "none"}`,
        );
      }
      if (!header.kid) {
        throw new AppleTokenError("missing_kid", "Token header is missing kid.");
      }

      const publicKeyPem = await this.resolveSigningKey(header.kid);

      let payload: {
        email?: string;
        sub?: string;
        nonce?: string;
        nonce_supported?: boolean;
        email_verified?: boolean | string;
        exp?: number;
      };
      try {
        payload = verifyJwt(idToken, publicKeyPem, {
          algorithms: ["RS256"],
          issuer: APPLE_ISSUER,
          // Non-empty (guarded above); typed as a non-empty tuple for jsonwebtoken.
          audience: audiences as [string, ...string[]],
        }) as typeof payload;
      } catch (error) {
        throw this.mapJwtError(error);
      }

      // Nonce binding (replay defense). When the caller requires a nonce, the
      // request MUST carry an expected value and the token MUST echo it. This is
      // the enforcement point for the "current clients must bind a nonce" rule;
      // the time-bounded compatibility path (legacy clients that send none) is
      // decided by the caller via `requireNonce`.
      if (options?.requireNonce && !options.expectedNonce) {
        throw new AppleTokenError(
          "nonce_required",
          "A nonce is required but none was supplied by the client.",
        );
      }
      if (options?.expectedNonce) {
        if (!payload.nonce || payload.nonce !== options.expectedNonce) {
          throw new AppleTokenError(
            "nonce_mismatch",
            "Token nonce does not match the expected value.",
          );
        }
      }

      if (!payload.sub) {
        throw new AppleTokenError("missing_sub", "Token is missing subject.");
      }
      if (!payload.email) {
        // Apple only returns email when the user consents / on first grant.
        throw new AppleTokenError("missing_email", "Token is missing email.");
      }

      return {
        email: payload.email,
        sub: payload.sub,
        emailVerified:
          payload.email_verified === true || payload.email_verified === "true",
        exp: payload.exp,
      };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }

      const code =
        error instanceof AppleTokenError ? error.code : "verification_failed";
      // Safe structured diagnostics only — never the token, claims, or secrets.
      this.logger.warn(
        `provider=apple errorCode=${code} kid=${safeKid ?? "unknown"} alg=${safeAlg ?? "unknown"}`,
      );
      throw new UnauthorizedException("Could not verify Apple identity token");
    }
  }

  /** Decode the JWT header segment without verifying the signature. */
  private decodeHeader(idToken: string): AppleTokenHeader {
    const segment = idToken.split(".")[0];
    if (!segment) {
      throw new AppleTokenError("malformed_token", "Token is malformed.");
    }
    try {
      const json = Buffer.from(segment, "base64url").toString("utf8");
      const header = JSON.parse(json) as AppleTokenHeader;
      if (!header || typeof header !== "object") {
        throw new Error("header not an object");
      }
      return header;
    } catch {
      throw new AppleTokenError("malformed_token", "Token header is invalid.");
    }
  }

  /**
   * Return the SPKI PEM for a kid, fetching/refreshing the JWKS as needed.
   * On an unknown kid (key rotation) we force one refresh before giving up.
   */
  private async resolveSigningKey(kid: string): Promise<string> {
    const cacheFresh =
      this.jwksCache !== null &&
      Date.now() - this.jwksCache.fetchedAt < JWKS_CACHE_TTL_MS;

    if (cacheFresh) {
      const cached = this.jwksCache!.keys.get(kid);
      if (cached) {
        return cached;
      }
    }

    // Either stale, empty, or kid not present (possible rotation) — refresh once.
    const keys = await this.loadJwks();
    const key = keys.get(kid);
    if (!key) {
      throw new AppleTokenError(
        "unknown_kid",
        "No Apple public key matches the token kid.",
      );
    }
    return key;
  }

  /** Fetch + cache Apple's JWKS, coalescing concurrent callers. */
  private async loadJwks(): Promise<Map<string, string>> {
    if (this.inflightFetch) {
      return this.inflightFetch;
    }

    this.inflightFetch = this.fetchJwks()
      .then((keys) => {
        this.jwksCache = { keys, fetchedAt: Date.now() };
        return keys;
      })
      .finally(() => {
        this.inflightFetch = null;
      });

    return this.inflightFetch;
  }

  private async fetchJwks(): Promise<Map<string, string>> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      JWKS_FETCH_TIMEOUT_MS,
    );

    let response: Response;
    try {
      response = await fetch(APPLE_JWKS_URL, { signal: controller.signal });
    } catch {
      // Fail closed — never accept an unverifiable token because keys are down.
      throw new AppleTokenError(
        "jwks_unavailable",
        "Failed to fetch Apple public keys.",
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new AppleTokenError(
        "jwks_unavailable",
        `Apple JWKS endpoint returned ${response.status}.`,
      );
    }

    let data: { keys?: AppleJwk[] };
    try {
      data = (await response.json()) as { keys?: AppleJwk[] };
    } catch {
      throw new AppleTokenError(
        "jwks_unavailable",
        "Apple JWKS response was not valid JSON.",
      );
    }

    if (!Array.isArray(data.keys) || data.keys.length === 0) {
      throw new AppleTokenError(
        "jwks_unavailable",
        "Apple JWKS response contained no keys.",
      );
    }

    const keys = new Map<string, string>();
    for (const jwk of data.keys) {
      if (!jwk.kid || jwk.kty !== "RSA" || !jwk.n || !jwk.e) {
        continue;
      }
      try {
        const pem = createPublicKey({
          key: { kty: jwk.kty, n: jwk.n, e: jwk.e },
          format: "jwk",
        }).export({ type: "spki", format: "pem" }) as string;
        keys.set(jwk.kid, pem);
      } catch {
        // Skip any key we cannot import; others may still match.
        continue;
      }
    }

    if (keys.size === 0) {
      throw new AppleTokenError(
        "jwks_unavailable",
        "No usable RSA keys in Apple JWKS.",
      );
    }

    return keys;
  }

  /** Translate jsonwebtoken errors into typed, safe-coded failures. */
  private mapJwtError(error: unknown): AppleTokenError {
    if (error instanceof TokenExpiredError) {
      return new AppleTokenError("token_expired", "Apple token has expired.");
    }
    if (error instanceof NotBeforeError) {
      return new AppleTokenError("token_not_active", "Apple token not yet active.");
    }
    if (error instanceof JsonWebTokenError) {
      const message = error.message.toLowerCase();
      if (message.includes("audience")) {
        return new AppleTokenError("invalid_audience", "Apple token audience mismatch.");
      }
      if (message.includes("issuer")) {
        return new AppleTokenError("invalid_issuer", "Apple token issuer mismatch.");
      }
      if (message.includes("signature")) {
        return new AppleTokenError("invalid_signature", "Apple token signature invalid.");
      }
      if (message.includes("algorithm")) {
        return new AppleTokenError("unsupported_algorithm", "Apple token algorithm invalid.");
      }
      if (message.includes("jwt malformed") || message.includes("invalid token")) {
        return new AppleTokenError("malformed_token", "Apple token is malformed.");
      }
      return new AppleTokenError("invalid_token", "Apple token is invalid.");
    }
    return new AppleTokenError("verification_failed", "Apple token verification failed.");
  }
}
