import type { Response } from "express";
import type { AdminRequest } from "../admin.types";
import { AdminAuthController } from "./admin-auth.controller";
import { AdminAuthService } from "./admin-auth.service";
import { AdminSessionService } from "./admin-session.service";

describe("AdminAuthController", () => {
  it("moves the MFA ticket into an HttpOnly challenge cookie", async () => {
    const authService = {
      login: jest.fn(() => ({
        status: "MFA_REQUIRED",
        ticket: "signed-mfa-ticket",
        admin: { id: "admin-1" },
      })),
    };
    const sessionService = { startMfaChallenge: jest.fn() };
    const controller = new AdminAuthController(
      authService as unknown as AdminAuthService,
      sessionService as unknown as AdminSessionService,
    );
    const response = {} as Response;

    await expect(controller.login(
      { email: "admin@example.test", password: "valid-password" },
      { adminRequestContext: undefined } as AdminRequest,
      response,
    )).resolves.toEqual({ status: "MFA_REQUIRED", admin: { id: "admin-1" } });
    expect(sessionService.startMfaChallenge).toHaveBeenCalledWith(response, "signed-mfa-ticket");
  });

  it("sets the browser session after MFA without returning the access token", async () => {
    const authService = {
      verifyMfa: jest.fn(() => ({
        status: "ACCESS_GRANTED",
        accessToken: "secret-access-token",
        admin: { id: "admin-1" },
      })),
    };
    const sessionService = {
      getMfaTicket: jest.fn(() => "cookie-ticket"),
      clearMfaChallenge: jest.fn(),
      startSession: jest.fn(() => "csrf-token"),
    };
    const controller = new AdminAuthController(
      authService as unknown as AdminAuthService,
      sessionService as unknown as AdminSessionService,
    );

    const result = await controller.verifyMfa(
      { code: "123456" },
      { adminRequestContext: undefined } as AdminRequest,
      {} as Response,
    );

    expect(authService.verifyMfa).toHaveBeenCalledWith(
      { code: "123456", ticket: "cookie-ticket" },
      undefined,
    );
    expect(sessionService.clearMfaChallenge).toHaveBeenCalledWith({});
    expect(sessionService.startSession).toHaveBeenCalledWith({}, "secret-access-token");
    expect(result).toEqual({ status: "ACCESS_GRANTED", admin: { id: "admin-1" }, csrfToken: "csrf-token" });
    expect(result).not.toHaveProperty("accessToken");
  });

  it("revokes the server session and clears both browser cookies on logout", async () => {
    const authService = { logout: jest.fn(() => ({ success: true })) };
    const sessionService = { clearSession: jest.fn() };
    const controller = new AdminAuthController(
      authService as unknown as AdminAuthService,
      sessionService as unknown as AdminSessionService,
    );
    const actor = { id: "admin-1" };
    const request = {
      adminUser: actor,
      adminSessionToken: "signed-session",
      adminSessionExpiresAt: 1_800_000_000,
      adminRequestContext: { ipAddress: "127.0.0.1" },
    } as unknown as AdminRequest;
    const response = {} as Response;

    await expect(controller.logout(request, response)).resolves.toEqual({ success: true });
    expect(authService.logout).toHaveBeenCalledWith(
      actor,
      "signed-session",
      1_800_000_000,
      request.adminRequestContext,
      undefined,
    );
    expect(sessionService.clearSession).toHaveBeenCalledWith(response);
  });

  it("still clears browser cookies when server-side logout persistence fails", async () => {
    const authService = { logout: jest.fn(() => Promise.reject(new Error("audit unavailable"))) };
    const sessionService = { clearSession: jest.fn() };
    const controller = new AdminAuthController(
      authService as unknown as AdminAuthService,
      sessionService as unknown as AdminSessionService,
    );
    const response = {} as Response;

    await expect(controller.logout({
      adminUser: { id: "admin-1" },
      adminSessionToken: "signed-session",
    } as unknown as AdminRequest, response)).rejects.toThrow("audit unavailable");
    expect(sessionService.clearSession).toHaveBeenCalledWith(response);
  });
});
