import { ForbiddenException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { NextFunction, Request, Response } from "express";
import { AdminSessionService } from "../auth/admin-session.service";
import { AdminCsrfMiddleware } from "./admin-csrf.middleware";

describe("AdminCsrfMiddleware", () => {
  const sessionService = {
    getSessionToken: jest.fn(() => "session"),
    getCsrfCookie: jest.fn(() => "csrf-value"),
  };
  const config = {
    get: jest.fn((key: string) => key === "ADMIN_FRONTEND_ORIGIN" ? "https://admin.repitair.com" : undefined),
  };
  const next = jest.fn() as NextFunction;

  beforeEach(() => jest.clearAllMocks());

  it("accepts a credentialed state-changing request with matching CSRF proof", () => {
    const middleware = new AdminCsrfMiddleware(
      config as unknown as ConfigService,
      sessionService as unknown as AdminSessionService,
    );
    const request = {
      method: "POST",
      originalUrl: "/api/admin/users/1/suspend",
      headers: { origin: "https://admin.repitair.com", "x-csrf-token": "csrf-value" },
    } as unknown as Request;

    middleware.use(request, {} as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("rejects a mismatched CSRF token", () => {
    const middleware = new AdminCsrfMiddleware(
      config as unknown as ConfigService,
      sessionService as unknown as AdminSessionService,
    );
    const request = {
      method: "DELETE",
      originalUrl: "/api/admin/repits/1",
      headers: { origin: "https://admin.repitair.com", "x-csrf-token": "wrong" },
    } as unknown as Request;

    expect(() => middleware.use(request, {} as Response, next)).toThrow(ForbiddenException);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a valid CSRF token from a non-admin origin", () => {
    const middleware = new AdminCsrfMiddleware(
      config as unknown as ConfigService,
      sessionService as unknown as AdminSessionService,
    );
    const request = {
      method: "PATCH",
      originalUrl: "/api/admin/users/1",
      headers: { origin: "https://repitair.com", "x-csrf-token": "csrf-value" },
    } as unknown as Request;

    expect(() => middleware.use(request, {} as Response, next)).toThrow(ForbiddenException);
    expect(next).not.toHaveBeenCalled();
  });

  it("does not require CSRF proof for login bootstrap", () => {
    const middleware = new AdminCsrfMiddleware(
      config as unknown as ConfigService,
      sessionService as unknown as AdminSessionService,
    );
    const request = {
      method: "POST",
      originalUrl: "/api/admin/auth/login",
      headers: {},
    } as unknown as Request;

    middleware.use(request, {} as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
