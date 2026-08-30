import {
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { generateKeyPairSync, type KeyObject } from "crypto";
import * as jwt from "jsonwebtoken";
import { AppleIdentityService } from "./apple-identity.service";

/**
 * Fully offline verification tests. We generate our own RSA keypairs, sign
 * RS256 tokens locally, and serve the matching public JWK through a mocked
 * `fetch`. No live Apple endpoint is contacted.
 */
describe("AppleIdentityService", () => {
  const ISSUER = "https://appleid.apple.com";
  const AUDIENCE = "apple-client-id";

  // Primary Apple signing key (kidA) + an unrelated "attacker" key.
  const appleKeyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const attackerKeyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const rotatedKeyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });

  const applePrivatePem = appleKeyPair.privateKey.export({
    type: "pkcs8",
    format: "pem",
  }) as string;
  const attackerPrivatePem = attackerKeyPair.privateKey.export({
    type: "pkcs8",
    format: "pem",
  }) as string;
  const rotatedPrivatePem = rotatedKeyPair.privateKey.export({
    type: "pkcs8",
    format: "pem",
  }) as string;

  function jwkFor(kid: string, publicKey: KeyObject) {
    const jwk = publicKey.export({ format: "jwk" }) as {
      kty: string;
      n: string;
      e: string;
    };
    return { kid, kty: jwk.kty, use: "sig", alg: "RS256", n: jwk.n, e: jwk.e };
  }

  function signToken(
    payloadOverrides: Record<string, unknown> = {},
    opts: { keyid?: string | null; key?: string; algorithm?: jwt.Algorithm } = {},
  ): string {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: ISSUER,
      aud: AUDIENCE,
      sub: "apple-sub-1",
      email: "user@example.com",
      iat: now,
      exp: now + 3600,
      ...payloadOverrides,
    };
    const signOptions: jwt.SignOptions = {
      algorithm: opts.algorithm ?? "RS256",
    };
    if (opts.keyid !== null) {
      signOptions.keyid = opts.keyid ?? "kidA";
    }
    return jwt.sign(payload, opts.key ?? applePrivatePem, signOptions);
  }

  function mockJwks(keys: unknown[]): jest.Mock {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ keys }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  function makeService(configOverrides: Record<string, string | undefined> = {}) {
    const values: Record<string, string | undefined> = {
      APPLE_CLIENT_ID: AUDIENCE,
      ...configOverrides,
    };
    const get = jest.fn((key: string) => values[key]);
    const config = { get } as unknown as ConfigService;
    return { service: new AppleIdentityService(config), get };
  }

  let warnSpy: jest.SpyInstance;
  const originalFetch = global.fetch;

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function loggedCode(): string | undefined {
    const line = warnSpy.mock.calls.map((c) => String(c[0])).find((l) => l.includes("errorCode="));
    return line?.match(/errorCode=(\w+)/)?.[1];
  }

  describe("successful verification", () => {
    it("verifies a valid RS256 token with correct iss/aud/kid/exp", async () => {
      const { service } = makeService();
      mockJwks([jwkFor("kidA", appleKeyPair.publicKey)]);

      const result = await service.verifyIdentityToken(signToken());

      expect(result).toEqual({ email: "user@example.com", sub: "apple-sub-1", emailVerified: false });
    });

    it("surfaces Apple's email_verified claim (string \"true\") as emailVerified", async () => {
      const { service } = makeService();
      mockJwks([jwkFor("kidA", appleKeyPair.publicKey)]);

      const result = await service.verifyIdentityToken(signToken({ email_verified: "true" }));

      expect(result.emailVerified).toBe(true);
    });

    it("requires a nonce when requireNonce is set and none is supplied", async () => {
      const { service } = makeService();
      mockJwks([jwkFor("kidA", appleKeyPair.publicKey)]);

      await expect(
        service.verifyIdentityToken(signToken({ nonce: "abc" }), { requireNonce: true }),
      ).rejects.toThrow(UnauthorizedException);
      expect(loggedCode()).toBe("nonce_required");
    });

    it("accepts a matching nonce when requireNonce is set", async () => {
      const { service } = makeService();
      mockJwks([jwkFor("kidA", appleKeyPair.publicKey)]);

      const result = await service.verifyIdentityToken(
        signToken({ nonce: "abc" }),
        { requireNonce: true, expectedNonce: "abc" },
      );
      expect(result.sub).toBe("apple-sub-1");
    });

    it("accepts a token whose aud is a secondary configured client (Services ID)", async () => {
      const { service } = makeService({ APPLE_SERVICE_ID: "com.repitair.web" });
      mockJwks([jwkFor("kidA", appleKeyPair.publicKey)]);

      const result = await service.verifyIdentityToken(
        signToken({ aud: "com.repitair.web" }),
      );

      expect(result.sub).toBe("apple-sub-1");
    });

    it("caches JWKS across logins (single fetch for repeat kid)", async () => {
      const { service } = makeService();
      const fetchMock = mockJwks([jwkFor("kidA", appleKeyPair.publicKey)]);

      await service.verifyIdentityToken(signToken());
      await service.verifyIdentityToken(signToken({ sub: "apple-sub-2" }));

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("refreshes JWKS when it sees an unknown kid (key rotation)", async () => {
      const { service } = makeService();
      const fetchMock = mockJwks([jwkFor("kidA", appleKeyPair.publicKey)]);

      await service.verifyIdentityToken(signToken());
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Apple rotates in kidB; the new token is signed with it.
      mockJwks([
        jwkFor("kidA", appleKeyPair.publicKey),
        jwkFor("kidB", rotatedKeyPair.publicKey),
      ]);
      const rotated = signToken(
        { sub: "apple-sub-3" },
        { keyid: "kidB", key: rotatedPrivatePem },
      );

      const result = await service.verifyIdentityToken(rotated);
      expect(result.sub).toBe("apple-sub-3");
    });
  });

  describe("rejections", () => {
    it("rejects an HS256 token before verifying (algorithm confusion)", async () => {
      const { service } = makeService();
      const fetchMock = mockJwks([jwkFor("kidA", appleKeyPair.publicKey)]);
      const hs = jwt.sign({ iss: ISSUER, aud: AUDIENCE, sub: "x", email: "e@x.com" }, "shared-secret", {
        algorithm: "HS256",
        keyid: "kidA",
      });

      await expect(service.verifyIdentityToken(hs)).rejects.toThrow(UnauthorizedException);
      expect(loggedCode()).toBe("unsupported_algorithm");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects a token with no kid", async () => {
      const { service } = makeService();
      mockJwks([jwkFor("kidA", appleKeyPair.publicKey)]);

      await expect(
        service.verifyIdentityToken(signToken({}, { keyid: null })),
      ).rejects.toThrow(UnauthorizedException);
      expect(loggedCode()).toBe("missing_kid");
    });

    it("rejects a token whose kid matches no Apple key", async () => {
      const { service } = makeService();
      mockJwks([jwkFor("kidA", appleKeyPair.publicKey)]);

      await expect(
        service.verifyIdentityToken(signToken({}, { keyid: "kidGhost" })),
      ).rejects.toThrow(UnauthorizedException);
      expect(loggedCode()).toBe("unknown_kid");
    });

    it("rejects a forged signature (token signed by a different key)", async () => {
      const { service } = makeService();
      mockJwks([jwkFor("kidA", appleKeyPair.publicKey)]);
      // Claims kidA but is signed with the attacker key.
      const forged = signToken({}, { keyid: "kidA", key: attackerPrivatePem });

      await expect(service.verifyIdentityToken(forged)).rejects.toThrow(UnauthorizedException);
      expect(loggedCode()).toBe("invalid_signature");
    });

    it("rejects a wrong issuer", async () => {
      const { service } = makeService();
      mockJwks([jwkFor("kidA", appleKeyPair.publicKey)]);

      await expect(
        service.verifyIdentityToken(signToken({ iss: "https://evil.example.com" })),
      ).rejects.toThrow(UnauthorizedException);
      expect(loggedCode()).toBe("invalid_issuer");
    });

    it("rejects a wrong audience", async () => {
      const { service } = makeService();
      mockJwks([jwkFor("kidA", appleKeyPair.publicKey)]);

      await expect(
        service.verifyIdentityToken(signToken({ aud: "some-other-app" })),
      ).rejects.toThrow(UnauthorizedException);
      expect(loggedCode()).toBe("invalid_audience");
    });

    it("rejects an expired token", async () => {
      const { service } = makeService();
      mockJwks([jwkFor("kidA", appleKeyPair.publicKey)]);
      const now = Math.floor(Date.now() / 1000);

      await expect(
        service.verifyIdentityToken(signToken({ iat: now - 7200, exp: now - 3600 })),
      ).rejects.toThrow(UnauthorizedException);
      expect(loggedCode()).toBe("token_expired");
    });

    it("rejects a malformed token", async () => {
      const { service } = makeService();
      mockJwks([jwkFor("kidA", appleKeyPair.publicKey)]);

      await expect(service.verifyIdentityToken("not-a-jwt")).rejects.toThrow(UnauthorizedException);
      expect(loggedCode()).toBe("malformed_token");
    });

    it("rejects when the nonce does not match", async () => {
      const { service } = makeService();
      mockJwks([jwkFor("kidA", appleKeyPair.publicKey)]);

      await expect(
        service.verifyIdentityToken(signToken({ nonce: "abc" }), { expectedNonce: "different" }),
      ).rejects.toThrow(UnauthorizedException);
      expect(loggedCode()).toBe("nonce_mismatch");
    });

    it("accepts a matching nonce when one is supplied", async () => {
      const { service } = makeService();
      mockJwks([jwkFor("kidA", appleKeyPair.publicKey)]);

      const result = await service.verifyIdentityToken(signToken({ nonce: "abc" }), {
        expectedNonce: "abc",
      });
      expect(result.sub).toBe("apple-sub-1");
    });

    it("fails closed when the JWKS endpoint is unavailable", async () => {
      const { service } = makeService();
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 }) as unknown as typeof fetch;

      await expect(service.verifyIdentityToken(signToken())).rejects.toThrow(UnauthorizedException);
      expect(loggedCode()).toBe("jwks_unavailable");
    });

    it("fails closed when the JWKS fetch throws", async () => {
      const { service } = makeService();
      global.fetch = jest.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;

      await expect(service.verifyIdentityToken(signToken())).rejects.toThrow(UnauthorizedException);
      expect(loggedCode()).toBe("jwks_unavailable");
    });
  });

  describe("configuration", () => {
    it("throws ServiceUnavailable and never contacts Apple when unconfigured", async () => {
      const { service } = makeService({ APPLE_CLIENT_ID: undefined });
      const fetchMock = jest.fn();
      global.fetch = fetchMock as unknown as typeof fetch;

      await expect(service.verifyIdentityToken(signToken())).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("separation from Apple Music", () => {
    it("never reads any APPLE_MUSIC_* credential during verification", async () => {
      const { service, get } = makeService();
      mockJwks([jwkFor("kidA", appleKeyPair.publicKey)]);

      await service.verifyIdentityToken(signToken());

      const readKeys = get.mock.calls.map((c) => c[0] as string);
      expect(readKeys.some((k) => k.startsWith("APPLE_MUSIC"))).toBe(false);
    });

    it("rejects an opaque Apple Music user token as an identity token", async () => {
      const { service } = makeService();
      mockJwks([jwkFor("kidA", appleKeyPair.publicKey)]);

      // A Music User Token is an opaque string, not a signed identity JWT.
      await expect(
        service.verifyIdentityToken("AmVn1...opaque-music-user-token...=="),
      ).rejects.toThrow(UnauthorizedException);
      expect(["malformed_token", "unknown_kid", "unsupported_algorithm"]).toContain(loggedCode());
    });
  });
});
