import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomBytes } from "crypto";
import type { Request, Response, CookieOptions } from "express";
import { AdminTokenService } from "./admin-token.service";

export const ADMIN_SESSION_COOKIE = "ra_admin_session";
export const ADMIN_CSRF_COOKIE = "ra_admin_csrf";
export const ADMIN_MFA_COOKIE = "ra_admin_mfa";

type AdminSameSite = "lax" | "strict" | "none";

@Injectable()
export class AdminSessionService {
  private readonly secure: boolean;
  private readonly sameSite: AdminSameSite;
  private readonly path: string;
  private readonly mfaPath: string;
  private readonly domain?: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly tokenService: AdminTokenService,
  ) {
    const isProduction = this.configService.get<string>("NODE_ENV") === "production";
    this.secure = isProduction || this.configService.get<string>("ADMIN_COOKIE_SECURE") === "true";
    this.sameSite = (this.configService.get<string>("ADMIN_COOKIE_SAME_SITE") ?? "lax") as AdminSameSite;
    this.path = this.configService.get<string>("ADMIN_COOKIE_PATH") ?? "/api/admin";
    this.mfaPath = this.configService.get<string>("ADMIN_MFA_COOKIE_PATH") ?? "/api/admin/auth";
    this.domain = this.configService.get<string>("ADMIN_COOKIE_DOMAIN") || undefined;
  }

  startSession(response: Response, accessToken: string): string {
    const payload = this.tokenService.verifyAccessToken(accessToken);
    const maxAge = Math.max(((payload.exp ?? 0) * 1000) - Date.now(), 1_000);
    const csrfToken = randomBytes(32).toString("base64url");

    response.cookie(ADMIN_SESSION_COOKIE, accessToken, {
      ...this.baseCookieOptions(),
      httpOnly: true,
      maxAge,
    });
    response.cookie(ADMIN_CSRF_COOKIE, csrfToken, {
      ...this.baseCookieOptions(),
      httpOnly: true,
      maxAge,
    });

    return csrfToken;
  }

  startMfaChallenge(response: Response, ticket: string): void {
    const payload = this.tokenService.verifyMfaTicket(ticket);
    const maxAge = Math.max(((payload.exp ?? 0) * 1000) - Date.now(), 1_000);
    response.cookie(ADMIN_MFA_COOKIE, ticket, {
      ...this.mfaCookieOptions(),
      httpOnly: true,
      maxAge,
    });
  }

  getMfaTicket(request: Request): string | null {
    return this.readCookie(request, ADMIN_MFA_COOKIE);
  }

  clearMfaChallenge(response: Response): void {
    response.clearCookie(ADMIN_MFA_COOKIE, { ...this.mfaCookieOptions(), httpOnly: true });
  }

  getOrCreateCsrfToken(request: Request, response: Response, expiresAt?: number): string {
    const existing = this.readCookie(request, ADMIN_CSRF_COOKIE);
    if (existing) return existing;

    const csrfToken = randomBytes(32).toString("base64url");
    const maxAge = expiresAt ? Math.max((expiresAt * 1000) - Date.now(), 1_000) : undefined;
    response.cookie(ADMIN_CSRF_COOKIE, csrfToken, {
      ...this.baseCookieOptions(),
      httpOnly: true,
      ...(maxAge ? { maxAge } : {}),
    });
    return csrfToken;
  }

  getSessionToken(request: Request): string | null {
    return this.readCookie(request, ADMIN_SESSION_COOKIE);
  }

  getCsrfCookie(request: Request): string | null {
    return this.readCookie(request, ADMIN_CSRF_COOKIE);
  }

  clearSession(response: Response): void {
    const options = this.baseCookieOptions();
    response.clearCookie(ADMIN_SESSION_COOKIE, { ...options, httpOnly: true });
    response.clearCookie(ADMIN_CSRF_COOKIE, { ...options, httpOnly: true });
    this.clearMfaChallenge(response);
  }

  private baseCookieOptions(): CookieOptions {
    return {
      secure: this.secure,
      sameSite: this.sameSite,
      path: this.path,
      ...(this.domain ? { domain: this.domain } : {}),
    };
  }

  private mfaCookieOptions(): CookieOptions {
    return {
      secure: this.secure,
      sameSite: this.sameSite,
      path: this.mfaPath,
      ...(this.domain ? { domain: this.domain } : {}),
    };
  }

  private readCookie(request: Request, name: string): string | null {
    const cookieHeader = request.headers.cookie;
    if (!cookieHeader) return null;

    for (const entry of cookieHeader.split(";")) {
      const separator = entry.indexOf("=");
      if (separator < 0) continue;
      const key = entry.slice(0, separator).trim();
      if (key !== name) continue;
      const value = entry.slice(separator + 1).trim();
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }

    return null;
  }
}
