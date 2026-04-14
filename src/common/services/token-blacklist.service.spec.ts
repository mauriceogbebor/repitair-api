import { TokenBlacklistService } from "./token-blacklist.service";

describe("TokenBlacklistService", () => {
  let service: TokenBlacklistService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TokenBlacklistService();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("add + isBlacklisted", () => {
    it("should report token as blacklisted when added", () => {
      const token = "test.jwt.token";

      service.add(token, Math.floor(Date.now() / 1000) + 60 * 60);

      expect(service.isBlacklisted(token)).toBe(true);
    });

    it("should return false for tokens not added", () => {
      const token = "unknown.token";

      expect(service.isBlacklisted(token)).toBe(false);
    });
  });

  describe("add with past-expiry timestamp", () => {
    it("should return false when token is already expired", () => {
      const token = "expired.token";
      const pastExpiry = Math.floor(Date.now() / 1000) - 60; // 1 minute ago

      service.add(token, pastExpiry);

      expect(service.isBlacklisted(token)).toBe(false);
    });

    it("should remove expired entry when checking", () => {
      jest.useFakeTimers();
      const now = Math.floor(Date.now() / 1000);
      const token = "expired.token";

      service.add(token, now + 60); // Add with 60 sec expiry
      expect(service.isBlacklisted(token)).toBe(true);

      // Fast-forward 70 seconds
      jest.advanceTimersByTime(70 * 1000);

      expect(service.isBlacklisted(token)).toBe(false);
      jest.useRealTimers();
    });
  });

  describe("add without expiresAt", () => {
    it("should use default (~7 days out) and report as blacklisted", () => {
      const token = "token.with.default.expiry";

      service.add(token);

      expect(service.isBlacklisted(token)).toBe(true);
    });

    it("should eventually expire after 7 days", () => {
      jest.useFakeTimers();
      const token = "token.expiring.in.7days";

      service.add(token); // No expiresAt provided, should use default

      // Token should be blacklisted immediately
      expect(service.isBlacklisted(token)).toBe(true);

      // Fast-forward 7 days + 1 second
      jest.advanceTimersByTime((7 * 24 * 60 * 60 + 1) * 1000);

      // Should no longer be blacklisted
      expect(service.isBlacklisted(token)).toBe(false);
      jest.useRealTimers();
    });
  });

  describe("multiple tokens", () => {
    it("should track multiple distinct tokens", () => {
      const token1 = "token.one";
      const token2 = "token.two";
      const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;

      service.add(token1, expiresAt);
      service.add(token2, expiresAt);

      expect(service.isBlacklisted(token1)).toBe(true);
      expect(service.isBlacklisted(token2)).toBe(true);
    });

    it("should independently track expiry for each token", () => {
      jest.useFakeTimers();
      const now = Math.floor(Date.now() / 1000);
      const token1 = "token.expires.soon";
      const token2 = "token.expires.later";

      service.add(token1, now + 30);
      service.add(token2, now + 120);

      // Both blacklisted initially
      expect(service.isBlacklisted(token1)).toBe(true);
      expect(service.isBlacklisted(token2)).toBe(true);

      // Fast-forward 40 seconds
      jest.advanceTimersByTime(40 * 1000);

      // token1 expired, token2 still valid
      expect(service.isBlacklisted(token1)).toBe(false);
      expect(service.isBlacklisted(token2)).toBe(true);

      jest.useRealTimers();
    });
  });

  describe("edge cases", () => {
    it("should handle tokens with special characters", () => {
      const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
      const expiresAt = Math.floor(Date.now() / 1000) + 3600;

      service.add(token, expiresAt);

      expect(service.isBlacklisted(token)).toBe(true);
    });

    it("should handle empty string token", () => {
      const token = "";
      const expiresAt = Math.floor(Date.now() / 1000) + 3600;

      service.add(token, expiresAt);

      expect(service.isBlacklisted(token)).toBe(true);
    });

    it("should handle very large expiry values", () => {
      const token = "token.with.large.expiry";
      const largeExpiry = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60 * 10; // 10 years

      service.add(token, largeExpiry);

      expect(service.isBlacklisted(token)).toBe(true);
    });
  });
});
