import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { TokenBlacklistService } from "../../../common/services/token-blacklist.service";
import { AdminAuthService } from "../auth/admin-auth.service";
import { AdminSessionService } from "../auth/admin-session.service";
import { AdminTokenService } from "../auth/admin-token.service";
import { AdminSessionRegistryService } from "../iam/admin-session-registry.service";
import { AdminJwtAuthGuard } from "./admin-jwt-auth.guard";

describe("AdminJwtAuthGuard", () => {
  const request: Record<string, unknown> = {};
  const response = {};
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
  const tokenService = { verifyAccessToken: jest.fn(() => ({ sub: "admin-1", exp: 1234 })) };
  const authService = {
    resolveActor: jest.fn(() => ({ id: "admin-1", status: "active", permissionKeys: [], roleKeys: [] })),
  };
  const sessionService = { getSessionToken: jest.fn(() => "cookie-token"), clearSession: jest.fn() };
  const blacklist = { isBlacklisted: jest.fn(() => false) };
  const registry = { validateAndTouch: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(request)) delete request[key];
  });

  it("authenticates from the HttpOnly session cookie without a bearer header", async () => {
    const guard = new AdminJwtAuthGuard(
      tokenService as unknown as AdminTokenService,
      authService as unknown as AdminAuthService,
      sessionService as unknown as AdminSessionService,
      blacklist as unknown as TokenBlacklistService,
      registry as unknown as AdminSessionRegistryService,
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.adminSessionToken).toBe("cookie-token");
    expect(request.adminUser).toEqual(expect.objectContaining({ id: "admin-1" }));
  });

  it("clears an invalid browser session", async () => {
    sessionService.getSessionToken.mockReturnValueOnce(null as unknown as string);
    const guard = new AdminJwtAuthGuard(
      tokenService as unknown as AdminTokenService,
      authService as unknown as AdminAuthService,
      sessionService as unknown as AdminSessionService,
      blacklist as unknown as TokenBlacklistService,
      registry as unknown as AdminSessionRegistryService,
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(sessionService.clearSession).toHaveBeenCalledWith(response);
  });

  it("validates a persisted session id before resolving the actor", async () => {
    tokenService.verifyAccessToken.mockReturnValueOnce({ sub: "admin-1", sid: "session-1", exp: 1234 } as any);
    const guard = new AdminJwtAuthGuard(
      tokenService as unknown as AdminTokenService,
      authService as unknown as AdminAuthService,
      sessionService as unknown as AdminSessionService,
      blacklist as unknown as TokenBlacklistService,
      registry as unknown as AdminSessionRegistryService,
    );
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(registry.validateAndTouch).toHaveBeenCalledWith("session-1", "admin-1");
    expect(request.adminSessionId).toBe("session-1");
  });
});
