import { NotFoundException, UnauthorizedException } from "@nestjs/common";
import type { Repository } from "typeorm";
import type { AdminSession, AdminUser } from "../../../entities";
import { AdminSessionRegistryService } from "./admin-session-registry.service";

describe("AdminSessionRegistryService", () => {
  const sessionRepository = { create: jest.fn((value) => value), save: jest.fn((value) => value), findOne: jest.fn(), find: jest.fn() };
  const adminUserRepository = { update: jest.fn() };
  const service = new AdminSessionRegistryService(sessionRepository as unknown as Repository<AdminSession>, adminUserRepository as unknown as Repository<AdminUser>);

  beforeEach(() => jest.clearAllMocks());

  it("persists a revocable session with parsed device metadata", async () => {
    await service.createSession({ id: "10000000-0000-4000-8000-000000000001", adminUserId: "admin-1", expiresAt: new Date("2030-01-01"), context: { requestId: "req", ipAddress: "127.0.0.1", userAgent: "Mozilla/5.0 (Mac OS X) AppleWebKit Safari/17", method: "POST", path: "/admin/auth/verify-mfa" } });
    expect(sessionRepository.save).toHaveBeenCalledWith(expect.objectContaining({ browser: "Safari", operatingSystem: "macOS", adminUserId: "admin-1" }));
  });

  it("rejects an expired persisted session", async () => {
    sessionRepository.findOne.mockResolvedValue({ id: "session", expiresAt: new Date(Date.now() - 1_000), revokedAt: null });
    await expect(service.validateAndTouch("session", "admin-1")).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("touches active sessions and administrator activity at most once per minute", async () => {
    const session = { id: "session", expiresAt: new Date(Date.now() + 60_000), revokedAt: null, lastActivityAt: new Date(Date.now() - 61_000) };
    sessionRepository.findOne.mockResolvedValue(session);
    await service.validateAndTouch("session", "admin-1");
    expect(sessionRepository.save).toHaveBeenCalledWith(session);
    expect(adminUserRepository.update).toHaveBeenCalledWith("admin-1", expect.objectContaining({ lastActivityAt: expect.any(Date) }));
  });

  it("does not silently accept an unknown session during revocation", async () => {
    sessionRepository.findOne.mockResolvedValue(null);
    await expect(service.revokeSession("missing", "admin-1", "actor-1", "security response")).rejects.toBeInstanceOf(NotFoundException);
  });
});
