import { ConfigService } from "@nestjs/config";
import { TokenBlacklistService } from "./token-blacklist.service";

describe("TokenBlacklistService", () => {
  let service: TokenBlacklistService;

  beforeEach(() => {
    jest.clearAllMocks();
    const configService = { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService;
    service = new TokenBlacklistService(configService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("add + isBlacklisted", () => {
    it("should report token as blacklisted when added", async () => {
      const token = "test.jwt.token";

      await service.add(token, Math.floor(Date.now() / 1000) + 60 * 60);

      expect(await service.isBlacklisted(token)).toBe(true);
    });

    it("should return false for tokens not added", async () => {
      const token = "unknown.token";

      expect(await service.isBlacklisted(token)).toBe(false);
    });
  });

  describe("add with past-expiry timestamp", () => {
    it("should return false when token is already expired", async () => {
      const token = "expired.token";
      const pastExpiry = Math.floor(Date.now() / 1000) - 60; // 1 minute ago

      await service.add(token, pastExpiry);

      expect(await service.isBlacklisted(token)).toBe(false);
    });

    it("should remove expired entry when checking", async () => {
      jest.useFakeTimers();
      const now = Math.floor(Date.now() / 1000);
      const token = "expired.token";

      await service.add(token, now + 60); // Add with 60 sec expiry
      expect(await service.isBlacklisted(token)).toBe(true);

      // Fast-forward 70 seconds
      jest.advanceTimersByTime(70 * 1000);

      expect(await service.isBlacklisted(token)).toBe(false);
      jest.useRealTimers();
    });
  });

  describe("add without expiresAt", () => {
    it("should use default (~7 days out) and report as blacklisted", async () => {
      const token = "token.with.default.expiry";

      await service.add(token);

      expect(await service.isBlacklisted(token)).toBe(true);
    });

    it("should eventually expire after 7 days", async () => {
      jest.useFakeTimers();
      const token = "token.expiring.in.7days";

      await service.add(token); // No expiresAt provided, should use default

      // Token should be blacklisted immediately
      expect(await service.isBlacklisted(token)).toBe(true);

      // Fast-forward 7 days + 1 second
      jest.advanceTimersByTime((7 * 24 * 60 * 60 + 1) * 1000);

      // Should no longer be blacklisted
      expect(await service.isBlacklisted(token)).toBe(false);
      jest.useRealTimers();
    });
  });

  describe("multiple tokens", () => {
    it("should track multiple distinct tokens", async () => {
      const token1 = "token.one";
      const token2 = "token.two";
      const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;

      await service.add(token1, expiresAt);
      await service.add(token2, expiresAt);

      expect(await service.isBlacklisted(token1)).toBe(true);
      expect(await service.isBlacklisted(token2)).toBe(true);
    });

    it("should independently track expiry for each token", async () => {
      jest.useFakeTimers();
      const now = Math.floor(Date.now() / 1000);
      const token1 = "token.expires.soon";
      const token2 = "token.expires.later";

      await service.add(token1, now + 30);
      await service.add(token2, now + 120);

      // Both blacklisted initially
      expect(await service.isBlacklisted(token1)).toBe(true);
      expect(await service.isBlacklisted(token2)).toBe(true);

      // Fast-forward 40 seconds
      jest.advanceTimersByTime(40 * 1000);

      // token1 expired, token2 still valid
      expect(await service.isBlacklisted(token1)).toBe(false);
      expect(await service.isBlacklisted(token2)).toBe(true);

      jest.useRealTimers();
    });
  });

  describe("edge cases", () => {
    it("should handle tokens with special characters", async () => {
      const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
      const expiresAt = Math.floor(Date.now() / 1000) + 3600;

      await service.add(token, expiresAt);

      expect(await service.isBlacklisted(token)).toBe(true);
    });

    it("should handle empty string token", async () => {
      const token = "";
      const expiresAt = Math.floor(Date.now() / 1000) + 3600;

      await service.add(token, expiresAt);

      expect(await service.isBlacklisted(token)).toBe(true);
    });

    it("should handle very large expiry values", async () => {
      const token = "token.with.large.expiry";
      const largeExpiry = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60 * 10; // 10 years

      await service.add(token, largeExpiry);

      expect(await service.isBlacklisted(token)).toBe(true);
    });
  });
});
