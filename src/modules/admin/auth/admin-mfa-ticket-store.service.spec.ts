import { ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AdminMfaTicketStoreService } from "./admin-mfa-ticket-store.service";

const payload = {
  sub: "admin-1",
  email: "admin@example.test",
  jti: "ticket-1",
  tokenType: "admin-mfa-ticket" as const,
  exp: Math.floor(Date.now() / 1000) + 600,
};

describe("AdminMfaTicketStoreService", () => {
  it("atomically rejects a replay through Redis", async () => {
    const redis = { status: "ready", set: jest.fn().mockResolvedValueOnce("OK").mockResolvedValueOnce(null) };
    const config = { get: jest.fn(() => "production") };
    const service = new AdminMfaTicketStoreService(redis, config as unknown as ConfigService);

    await expect(service.consume(payload)).resolves.toBeUndefined();
    await expect(service.consume(payload)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(redis.set).toHaveBeenCalledWith(expect.stringContaining(payload.jti), "1", "EX", expect.any(Number), "NX");
  });

  it("fails closed in production when Redis is unavailable", async () => {
    const config = { get: jest.fn(() => "production") };
    const service = new AdminMfaTicketStoreService(null, config as unknown as ConfigService);

    await expect(service.consume(payload)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("returns a controlled outage when Redis fails during atomic consumption", async () => {
    const redis = { status: "ready", set: jest.fn().mockRejectedValue(new Error("connection lost")) };
    const config = { get: jest.fn(() => "production") };
    const service = new AdminMfaTicketStoreService(redis, config as unknown as ConfigService);

    await expect(service.consume(payload)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("uses a local one-time store for development and tests", async () => {
    const config = { get: jest.fn(() => "test") };
    const service = new AdminMfaTicketStoreService(null, config as unknown as ConfigService);

    await expect(service.consume(payload)).resolves.toBeUndefined();
    await expect(service.consume(payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
