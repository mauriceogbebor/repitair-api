import { ForbiddenException, Injectable, NestMiddleware } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { timingSafeEqual } from "crypto";
import type { NextFunction, Request, Response } from "express";
import { AdminSessionService } from "../auth/admin-session.service";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const AUTH_BOOTSTRAP_PATHS = ["/admin/auth/login", "/admin/auth/mfa-enrollment", "/admin/auth/verify-mfa"];
const LOCAL_ADMIN_ORIGINS = ["http://localhost:3002"];

@Injectable()
export class AdminCsrfMiddleware implements NestMiddleware {
  private readonly allowedOrigins: Set<string>;

  constructor(
    configService: ConfigService,
    private readonly sessionService: AdminSessionService,
  ) {
    const origins = [
      ...LOCAL_ADMIN_ORIGINS,
      configService.get<string>("ADMIN_FRONTEND_ORIGIN"),
    ].filter((origin): origin is string => Boolean(origin));
    this.allowedOrigins = new Set(origins);
  }

  use(request: Request, _response: Response, next: NextFunction): void {
    const requestPath = request.originalUrl.split("?")[0];
    if (SAFE_METHODS.has(request.method) || AUTH_BOOTSTRAP_PATHS.some((path) => requestPath.endsWith(path))) {
      next();
      return;
    }

    if (!this.sessionService.getSessionToken(request)) {
      next();
      return;
    }

    const origin = request.headers.origin;
    if (origin && !this.allowedOrigins.has(origin)) {
      throw new ForbiddenException("Admin request origin is not allowed");
    }

    const cookieToken = this.sessionService.getCsrfCookie(request);
    const headerValue = request.headers["x-csrf-token"];
    const headerToken = Array.isArray(headerValue) ? headerValue[0] : headerValue;

    if (!cookieToken || !headerToken || !this.matches(cookieToken, headerToken)) {
      throw new ForbiddenException("Invalid admin CSRF token");
    }

    next();
  }

  private matches(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
  }
}
