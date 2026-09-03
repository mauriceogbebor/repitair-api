import { ConfigService } from "@nestjs/config";
import type { Response } from "express";
import { ADMIN_CSRF_COOKIE, ADMIN_MFA_COOKIE, ADMIN_SESSION_COOKIE, AdminSessionService } from "./admin-session.service";
import { AdminTokenService } from "./admin-token.service";

describe("AdminSessionService", () => {
  const config = {
    get: jest.fn((key: string) => ({
      NODE_ENV: "production",
      ADMIN_COOKIE_SAME_SITE: "none",
      ADMIN_COOKIE_PATH: "/api/admin",
    })[key]),
  };
  const tokenService = {
    verifyAccessToken: jest.fn(() => ({ exp: Math.floor(Date.now() / 1000) + 3600 })),
    verifyMfaTicket: jest.fn(() => ({ exp: Math.floor(Date.now() / 1000) + 600 })),
  };
  const response = {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  } as unknown as Response;

  beforeEach(() => jest.clearAllMocks());

  it("issues HttpOnly, secure session and CSRF cookies after MFA", () => {
    const service = new AdminSessionService(
      config as unknown as ConfigService,
      tokenService as unknown as AdminTokenService,
    );

    const csrfToken = service.startSession(response, "signed-admin-token");

    expect(csrfToken).toHaveLength(43);
    expect(response.cookie).toHaveBeenCalledWith(
      ADMIN_SESSION_COOKIE,
      "signed-admin-token",
      expect.objectContaining({ httpOnly: true, secure: true, sameSite: "none", path: "/api/admin" }),
    );
    expect(response.cookie).toHaveBeenCalledWith(
      ADMIN_CSRF_COOKIE,
      csrfToken,
      expect.objectContaining({ httpOnly: true, secure: true, sameSite: "none", path: "/api/admin" }),
    );
  });

  it("stores the pre-auth challenge in a short-lived HttpOnly cookie", () => {
    const service = new AdminSessionService(
      config as unknown as ConfigService,
      tokenService as unknown as AdminTokenService,
    );

    service.startMfaChallenge(response, "signed-mfa-ticket");

    expect(response.cookie).toHaveBeenCalledWith(
      ADMIN_MFA_COOKIE,
      "signed-mfa-ticket",
      expect.objectContaining({ httpOnly: true, secure: true, sameSite: "none", path: "/api/admin/auth" }),
    );
  });

  it("clears both cookies using the same scope", () => {
    const service = new AdminSessionService(
      config as unknown as ConfigService,
      tokenService as unknown as AdminTokenService,
    );
    service.clearSession(response);
    expect(response.clearCookie).toHaveBeenCalledTimes(3);
    expect(response.clearCookie).toHaveBeenCalledWith(
      ADMIN_SESSION_COOKIE,
      expect.objectContaining({ secure: true, sameSite: "none", path: "/api/admin" }),
    );
  });
});
