import {
  Injectable,
  UnauthorizedException,
  Logger,
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
  ForbiddenException,
} from "@nestjs/common";
import { JwtService, type JwtSignOptions } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { createHmac, createPublicKey, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import * as jwt from "jsonwebtoken";

import { UsersService } from "../users/users.service";
import { MailService } from "../../common/services/mail.service";
import { TokenBlacklistService } from "../../common/services/token-blacklist.service";
import { LoginDto } from "./dto/login.dto";
import { SignupDto } from "./dto/signup.dto";
import { SocialAuthDto } from "./dto/social-auth.dto";
import { MusicConnectionsService } from "../music/music-connections.service";
import { AppleIdentityService } from "./apple-identity.service";
import { SocialIdentityService, type SocialConnection } from "./social-identity.service";
import { AnalyticsService, ANALYTICS_EVENTS } from "../analytics/analytics.service";
import type { SocialAuthProvider } from "../../entities";
import { spotifyRedirectUriProblem } from "./spotify-redirect-uri";

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly resetEmailDeliveryTimeoutMs = 10000;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
    private readonly tokenBlacklist: TokenBlacklistService,
    private readonly configService: ConfigService,
    private readonly appleIdentity: AppleIdentityService,
    private readonly socialIdentity: SocialIdentityService,
    @Optional() private readonly musicConnections?: MusicConnectionsService,
    @Optional() private readonly analytics?: AnalyticsService,
  ) {}

  /** Fire-and-forget analytics emit; never blocks or breaks the auth path. */
  private emit(name: string, userId: string, properties?: Record<string, unknown>) {
    void this.analytics?.track(name, { userId, properties, source: "backend" });
  }

  private requireSecret(key: string): string {
    const value = this.configService.get<string>(key);
    if (!value) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
  }

  private assertUserCanSignIn(user: { isSuspended?: boolean; suspensionReason?: string | null }) {
    if (user.isSuspended) {
      throw new ForbiddenException(user.suspensionReason || "This account has been suspended");
    }
  }

  async signup(dto: SignupDto) {
    const user = await this.usersService.createUser({
      fullName: dto.fullName,
      email: dto.email,
      password: dto.password,
      country: dto.country ?? "",
      signupSource: "email",
    });

    this.emit(ANALYTICS_EVENTS.USER_REGISTERED, user.id, { method: "email" });
    return this.issueSession(user);
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException("Invalid email or password");
    }

    // Social-only accounts have a random (unusable) password. Guide the user to
    // their provider instead of the misleading "invalid password" error. Guarded
    // to a strict false + social signupSource so legacy email rows (where the
    // column may read undefined) are never blocked.
    if (
      user.hasUsablePassword === false &&
      (user.signupSource === "google" || user.signupSource === "apple")
    ) {
      const provider = user.signupSource === "apple" ? "Apple" : "Google";
      throw new UnauthorizedException(
        `This account uses ${provider} Sign In. Continue with ${provider}, or use "Forgot password" to set a password.`,
      );
    }

    this.assertUserCanSignIn(user);

    const valid = await this.usersService.validatePassword(user, dto.password);
    if (!valid) {
      throw new UnauthorizedException("Invalid email or password");
    }

    await this.usersService.recordLogin(user.id);
    this.emit(ANALYTICS_EVENTS.LOGIN, user.id, { method: "email" });
    return this.issueSession(user);
  }

  async socialAuth(dto: SocialAuthDto) {
    // Verify the provider token and resolve the identity by its STABLE subject
    // (Apple/Google `sub`) — never by email alone. This is what prevents Apple
    // private-relay logins from creating a fresh account on each sign-in.
    const identity = await this.verifySocialToken(dto);
    const user = await this.socialIdentity.resolveUser({
      provider: dto.provider,
      subject: identity.subject,
      email: identity.email,
      emailVerified: identity.emailVerified,
      fullName: dto.fullName || identity.name || undefined,
      picture: identity.picture,
    });

    this.assertUserCanSignIn(user);
    await this.usersService.recordLogin(user.id);
    this.emit(ANALYTICS_EVENTS.LOGIN, user.id, { method: dto.provider });

    return this.issueSession(user);
  }

  /**
   * Attach a provider identity to the currently-authenticated user (the
   * "Connect account in Settings" flow). Rejects if the identity is already
   * linked to a different Repitair account.
   */
  async linkSocialProvider(userId: string, dto: SocialAuthDto) {
    const identity = await this.verifySocialToken(dto);
    await this.socialIdentity.linkToUser(userId, {
      provider: dto.provider,
      subject: identity.subject,
      email: identity.email,
      emailVerified: identity.emailVerified,
      fullName: dto.fullName || identity.name || undefined,
      picture: identity.picture,
    });
    return { linked: true, provider: dto.provider };
  }

  /**
   * The authentication methods a user can sign in with — social providers plus
   * email/password. Kept distinct from music-provider connections (Spotify /
   * Apple Music). Powers the mobile Connected Accounts screen.
   *
   * `hasPassword` is the authoritative "can sign in with email/password" signal
   * and is driven by `hasUsablePassword` (a social user who set a password via
   * forgot-password flips this to true), NOT by `signupSource`. `authProviders`
   * is kept for backward compatibility.
   */
  async getLinkedAuthProviders(userId: string): Promise<{
    authProviders: string[];
    hasPassword: boolean;
    email: string | null;
    connections: SocialConnection[];
  }> {
    const [connections, user] = await Promise.all([
      this.socialIdentity.getConnections(userId),
      this.usersService.findById(userId),
    ]);
    const hasPassword = user?.hasUsablePassword === true;
    const providers: string[] = connections.map((c) => c.provider);
    if (hasPassword) {
      providers.unshift("password");
    }
    return {
      authProviders: [...new Set(providers)],
      hasPassword,
      email: user?.email ?? null,
      connections,
    };
  }

  /**
   * Disconnect a social provider from the current user (the "Disconnect" action
   * on Connected Accounts). Enforces the invariant that a user can never remove
   * their last remaining sign-in method: the count of methods after removal must
   * stay ≥ 1, where methods = linked social providers + (usable password ? 1 : 0).
   */
  async unlinkSocialProvider(
    userId: string,
    provider: SocialAuthProvider,
  ): Promise<{
    authProviders: string[];
    hasPassword: boolean;
    email: string | null;
    connections: SocialConnection[];
  }> {
    const [linkedProviders, user] = await Promise.all([
      this.socialIdentity.getLinkedProviders(userId),
      this.usersService.findById(userId),
    ]);
    if (!user) {
      throw new NotFoundException("User not found");
    }
    if (!linkedProviders.includes(provider)) {
      throw new NotFoundException(`No ${provider} account is connected.`);
    }

    const hasPassword = user.hasUsablePassword === true;
    const methodsAfterRemoval =
      linkedProviders.filter((p) => p !== provider).length + (hasPassword ? 1 : 0);
    if (methodsAfterRemoval < 1) {
      throw new ConflictException("You must keep at least one sign-in method.");
    }

    await this.socialIdentity.unlink(userId, provider);
    return this.getLinkedAuthProviders(userId);
  }

  /**
   * Whether a nonce is mandatory for social auth right now. Nonce binding is the
   * replay defense for OAuth. Older released clients do not send one, so we allow
   * a single, explicit, time-bounded compatibility window controlled by config —
   * never an indefinitely-optional nonce:
   *   - `SOCIAL_AUTH_REQUIRE_NONCE=true` forces enforcement immediately, OR
   *   - the current date is on/after `SOCIAL_AUTH_NONCE_REQUIRED_AFTER` (ISO date).
   * Once either trips, a request without a verifiable nonce is rejected.
   */
  private nonceRequired(): boolean {
    if (this.configService.get<string>("SOCIAL_AUTH_REQUIRE_NONCE") === "true") {
      return true;
    }
    const cutoff = this.configService.get<string>("SOCIAL_AUTH_NONCE_REQUIRED_AFTER");
    if (cutoff) {
      const cutoffTime = Date.parse(cutoff);
      if (!Number.isNaN(cutoffTime) && Date.now() >= cutoffTime) {
        return true;
      }
    }
    return false;
  }

  private async verifySocialToken(
    dto: SocialAuthDto,
  ): Promise<{
    subject: string;
    email: string | null;
    emailVerified: boolean;
    name?: string | null;
    picture?: string | null;
  }> {
    const requireNonce = this.nonceRequired();
    if (dto.provider === "google") {
      const payload = await this.verifyGoogleIdToken(dto.idToken, dto.nonce, requireNonce);
      return {
        subject: payload.sub,
        email: payload.email,
        emailVerified: payload.emailVerified,
        name: payload.name,
        picture: payload.picture,
      };
    }
    const payload = await this.verifyAppleIdToken(dto.idToken, dto.nonce, requireNonce);
    return {
      subject: payload.sub,
      email: payload.email,
      emailVerified: payload.emailVerified,
      name: null,
      picture: null,
    };
  }

  private async verifyGoogleIdToken(
    idToken: string,
    expectedNonce?: string,
    requireNonce = false,
  ): Promise<{ email: string; emailVerified: boolean; name?: string; sub: string; picture?: string | null }> {
    // The token's `aud` is the client ID that INITIATED the OAuth request. On
    // iOS that is the iOS client ID, on Android the Android client ID — NOT the
    // web `GOOGLE_CLIENT_ID`. All client IDs the app can use must therefore be
    // accepted here, or valid logins fail with "audience mismatch".
    // `GOOGLE_ALLOWED_AUDIENCES` (comma-separated) lets every client ID be
    // enumerated in one env var, mirroring the Apple audience handling.
    const expectedClientIds = [
      ...new Set(
        [
          this.configService.get<string>("GOOGLE_CLIENT_ID"),
          this.configService.get<string>("GOOGLE_IOS_CLIENT_ID"),
          this.configService.get<string>("GOOGLE_ANDROID_CLIENT_ID"),
          ...(this.configService.get<string>("GOOGLE_ALLOWED_AUDIENCES")?.split(",") ?? []),
        ]
          .map((value) => value?.trim())
          .filter((value): value is string => Boolean(value)),
      ),
    ];

    if (!expectedClientIds.length) {
      throw new ServiceUnavailableException(
        "Google Sign In is not available. Configure GOOGLE_CLIENT_ID or platform specific Google client IDs.",
      );
    }

    try {
      const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
      if (!response.ok) {
        throw new UnauthorizedException("Invalid Google ID token");
      }
      const payload = (await response.json()) as {
        email?: string;
        email_verified?: boolean | string;
        name?: string;
        aud?: string;
        sub?: string;
        picture?: string;
        nonce?: string;
      };

      if (!payload.aud || !expectedClientIds.includes(payload.aud)) {
        // Safe diagnostics only (client IDs are not secrets, but log a suffix):
        // surfaces exactly which audience arrived vs how many are accepted, so a
        // missing GOOGLE_IOS_CLIENT_ID/ANDROID env is obvious in logs.
        const audSuffix = payload.aud ? `…${payload.aud.slice(-16)}` : "none";
        this.logger.warn(
          `provider=google audience_mismatch received_aud=${audSuffix} accepted_count=${expectedClientIds.length}`,
        );
        throw new UnauthorizedException("Google token audience mismatch");
      }

      if (!payload.email) {
        throw new UnauthorizedException("Google token missing email");
      }

      if (!payload.sub) {
        throw new UnauthorizedException("Google token missing subject");
      }

      // Nonce binding (replay defense). Enforce when required; when a nonce is
      // supplied it must match the token's `nonce` claim regardless.
      if (requireNonce && !expectedNonce) {
        throw new UnauthorizedException("Google token missing required nonce");
      }
      if (expectedNonce && payload.nonce !== expectedNonce) {
        this.logger.warn("provider=google nonce_mismatch");
        throw new UnauthorizedException("Google token nonce mismatch");
      }

      return {
        email: payload.email,
        emailVerified:
          payload.email_verified === true || payload.email_verified === "true",
        name: payload.name,
        sub: payload.sub,
        picture: payload.picture ?? null,
      };
    } catch (error) {
      if (error instanceof UnauthorizedException || error instanceof ServiceUnavailableException) throw error;
      this.logger.error("Google token verification failed", error);
      throw new UnauthorizedException("Failed to verify Google ID token");
    }
  }

  /**
   * Verify a "Sign in with Apple" identity token.
   *
   * Delegates to {@link AppleIdentityService}, which verifies the RS256 token
   * against Apple's JWKS public keys — NOT via NestJS `JwtService` (whose key is
   * the symmetric `JWT_SECRET`) and NOT with any Apple Music credential.
   */
  private async verifyAppleIdToken(
    idToken: string,
    nonce?: string,
    requireNonce = false,
  ): Promise<{ email: string; emailVerified: boolean; sub: string }> {
    const { email, sub, emailVerified } = await this.appleIdentity.verifyIdentityToken(
      idToken,
      { expectedNonce: nonce, requireNonce },
    );
    return { email, sub, emailVerified };
  }

  async forgotPassword(email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const code = await this.usersService.setResetCode(normalizedEmail);
    const user = await this.usersService.findByEmail(normalizedEmail);
    if (code && user) {
      this.mailService
        .sendPasswordResetCode(normalizedEmail, code, user.fullName)
        .catch((err: Error) => {
          this.logger.error(`Failed to send reset email to ${normalizedEmail}: ${err.message}`);
        });
    }
    return {
      message: "If that email exists, a verification code has been sent",
    };
  }

  async verifyCode(email: string, code: string) {
    const resetToken = await this.usersService.verifyResetCode(email, code);
    if (!resetToken) {
      throw new UnauthorizedException("Invalid or expired code");
    }
    return { verified: true, resetToken };
  }

  async resetPassword(email: string, resetToken: string, newPassword: string) {
    const success = await this.usersService.resetPassword(email, resetToken, newPassword);
    if (!success) {
      throw new UnauthorizedException("Could not reset password");
    }
    return { message: "Password has been reset successfully" };
  }

  async logout(token: string, refreshToken?: string) {
    try {
      const decoded = this.jwtService.decode(token) as { exp?: number; jti?: string } | null;
      const key = decoded?.jti ?? token;
      await this.tokenBlacklist.add(key, decoded?.exp);
    } catch {
      await this.tokenBlacklist.add(token);
    }
    if (refreshToken) {
      await this.revokeRefreshToken(refreshToken);
    }
    return { message: "Logged out successfully" };
  }

  async refresh(refreshToken: string) {
    let payload: { sub: string; email: string; jti: string; type: string; sessionVersion?: number; exp?: number };
    try {
      payload = this.jwtService.verify(refreshToken, { secret: this.getRefreshSecret() }) as typeof payload;
    } catch (error) {
      const expired = error instanceof Error && error.name === "TokenExpiredError";
      throw this.sessionUnauthorized(
        expired ? "REFRESH_TOKEN_EXPIRED" : "REFRESH_TOKEN_INVALID",
        expired ? "Your session has expired. Please sign in again." : "The refresh session is invalid.",
      );
    }

    if (payload.type !== "refresh" || !payload.sub || !payload.jti) {
      throw this.sessionUnauthorized("REFRESH_TOKEN_INVALID", "The refresh session is invalid.");
    }

    const blacklistKey = `refresh:${payload.jti}`;
    if (await this.tokenBlacklist.isBlacklisted(blacklistKey)) {
      throw this.sessionUnauthorized("REFRESH_TOKEN_REVOKED", "This session has been revoked.");
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw this.sessionUnauthorized("SESSION_INVALID", "The user session no longer exists.");
    }
    if (user.isSuspended) {
      throw this.sessionUnauthorized("ACCOUNT_DISABLED", "This account is unavailable.");
    }
    if ((payload.sessionVersion ?? 0) !== (user.sessionVersion ?? 0)) {
      throw this.sessionUnauthorized("REFRESH_TOKEN_REVOKED", "This session has been revoked.");
    }

    await this.tokenBlacklist.add(blacklistKey, payload.exp);
    return this.issueSession(user);
  }

  async upgradeSession(currentToken: string, userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw this.sessionUnauthorized("SESSION_INVALID", "The user session no longer exists.");
    }
    this.assertUserCanSignIn(user);
    await this.revokeAccessToken(currentToken);
    return this.issueSession(user);
  }

  async sendEmailVerification(userId: string, email: string) {
    const code = await this.usersService.setEmailVerifyCode(userId);
    if (code) {
      const user = await this.usersService.findById(userId);
      try {
        await this.mailService.sendRaw({
          to: email,
          subject: "Verify your Repitair email",
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 400px; margin: 0 auto; padding: 24px;">
              <h2 style="color: #111;">Verify your email</h2>
              <p>Hi ${user?.fullName ?? "there"}, use this code to verify your email address:</p>
              <div style="background: #f0f0f0; border-radius: 8px; padding: 16px; text-align: center; font-size: 32px; font-weight: 700; letter-spacing: 4px;">${code}</div>
              <p style="color: #888; font-size: 13px; margin-top: 16px;">This code expires in 30 minutes.</p>
            </div>
          `,
        });
      } catch (err) {
        this.logger.error(`Failed to send verification email to ${email}: ${(err as Error).message}`);
      }
    }

    return { message: "If that email exists, a verification code has been sent" };
  }

  async verifyEmail(userId: string, code: string) {
    const success = await this.usersService.verifyEmail(userId, code);
    if (!success) {
      throw new BadRequestException("Invalid or expired verification code");
    }
    return { verified: true };
  }

  private signToken(userId: string, email: string, sessionVersion: number): string {
    return this.jwtService.sign({ sub: userId, email, sessionVersion, jti: randomUUID() });
  }

  private issueSession(user: {
    id: string;
    fullName: string;
    email: string;
    country?: string;
    connectedPlatforms: string[];
    avatarUrl?: string | null;
    sessionVersion?: number;
  }) {
    const sessionVersion = user.sessionVersion ?? 0;
    const token = this.signToken(user.id, user.email, sessionVersion);
    const accessPayload = this.jwtService.decode(token) as { exp?: number } | null;
    const refreshJti = randomUUID();
    const refreshToken = this.jwtService.sign(
      { sub: user.id, email: user.email, sessionVersion, jti: refreshJti, type: "refresh" },
      {
        secret: this.getRefreshSecret(),
        expiresIn: (this.configService.get<string>("JWT_REFRESH_EXPIRES_IN") ?? "30d") as JwtSignOptions["expiresIn"],
      },
    );
    const refreshPayload = this.jwtService.decode(refreshToken) as { exp?: number } | null;

    return {
      token,
      refreshToken,
      expiresAt: accessPayload?.exp ? accessPayload.exp * 1000 : Date.now() + 7 * 24 * 60 * 60 * 1000,
      refreshTokenExpiresAt: refreshPayload?.exp ? refreshPayload.exp * 1000 : Date.now() + 30 * 24 * 60 * 60 * 1000,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        country: user.country,
        connectedPlatforms: user.connectedPlatforms,
        avatarUrl: user.avatarUrl ?? null,
      },
    };
  }

  private getRefreshSecret(): string {
    const configured = this.configService.get<string>("JWT_REFRESH_SECRET");
    if (configured) return configured;
    if ((this.configService.get<string>("NODE_ENV") ?? "development") !== "production") {
      return `${this.configService.get<string>("JWT_SECRET") ?? "dev-secret-change-me"}:refresh`;
    }
    throw new Error("JWT_REFRESH_SECRET is required in production");
  }

  private sessionUnauthorized(errorCode: string, message: string) {
    return new UnauthorizedException({ errorCode, message, retriable: false });
  }

  private async revokeAccessToken(token: string) {
    const decoded = this.jwtService.decode(token) as { exp?: number; jti?: string } | null;
    await this.tokenBlacklist.add(decoded?.jti ?? token, decoded?.exp);
  }

  private async revokeRefreshToken(token: string) {
    const decoded = this.jwtService.decode(token) as { exp?: number; jti?: string } | null;
    if (decoded?.jti) {
      await this.tokenBlacklist.add(`refresh:${decoded.jti}`, decoded.exp);
    }
  }

  private signOAuthState(userId: string): string {
    const secret = this.requireSecret("JWT_SECRET");
    const payload = Buffer.from(userId).toString("base64url");
    const sig = createHmac("sha256", secret).update(payload).digest("base64url");
    return `${payload}.${sig}`;
  }

  private verifyOAuthState(state: string): string {
    const secret = this.requireSecret("JWT_SECRET");
    const dotIndex = state.lastIndexOf(".");
    if (dotIndex === -1) throw new BadRequestException("Invalid state parameter");

    const payload = state.slice(0, dotIndex);
    const sig = state.slice(dotIndex + 1);

    const expectedSig = createHmac("sha256", secret).update(payload).digest("base64url");
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
      throw new BadRequestException("Invalid state parameter");
    }

    return Buffer.from(payload, "base64url").toString("utf8");
  }

  async buildAppleMusicAuthUrl(userId: string): Promise<string> {
    const teamId = this.configService.get<string>("APPLE_MUSIC_TEAM_ID");
    const keyId = this.configService.get<string>("APPLE_MUSIC_KEY_ID");
    const privateKeyStr = this.configService.get<string>("APPLE_MUSIC_PRIVATE_KEY");

    if (!teamId || !keyId || !privateKeyStr) {
      throw new ServiceUnavailableException(
        "Apple Music is not available. APPLE_MUSIC_TEAM_ID, APPLE_MUSIC_KEY_ID, and APPLE_MUSIC_PRIVATE_KEY must be configured.",
      );
    }

    const state = this.musicConnections
      ? await this.musicConnections.createOAuthState(userId, "apple-music")
      : this.signOAuthState(userId);

    const baseUrl = this.resolveAppleMusicAuthBaseUrl();
    const params = new URLSearchParams({ state });
    return `${baseUrl}/auth/apple-music/authorize?${params.toString()}`;
  }

  private resolveAppleMusicAuthBaseUrl(): string {
    const configuredBaseUrl = this.configService.get<string>("APPLE_MUSIC_AUTH_BASE_URL")?.trim();
    const nodeEnv = this.configService.get<string>("NODE_ENV")?.trim().toLowerCase();
    if (!configuredBaseUrl && nodeEnv === "production") {
      throw new ServiceUnavailableException(
        "Apple Music is not available. APPLE_MUSIC_AUTH_BASE_URL must be configured to an Apple-approved HTTPS origin.",
      );
    }

    const candidate = configuredBaseUrl
      || this.configService.get<string>("API_BASE_URL")?.trim()
      || "http://localhost:3000";
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      throw new ServiceUnavailableException("Apple Music authorization URL is invalid.");
    }

    const isLocalhost = ["localhost", "127.0.0.1"].includes(parsed.hostname);
    if (!isLocalhost && parsed.protocol !== "https:") {
      throw new ServiceUnavailableException("Apple Music authorization must use HTTPS.");
    }
    if (parsed.hostname.endsWith(".up.railway.app")) {
      throw new ServiceUnavailableException(
        "Apple Music authorization must use the Apple-approved custom domain, not a Railway service domain.",
      );
    }

    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  }

  async validateAppleMusicAuthorizationState(state: string): Promise<void> {
    if (!this.musicConnections) {
      throw new ServiceUnavailableException("Apple Music connection is not available right now.");
    }
    await this.musicConnections.validateOAuthState(state, "apple-music");
  }

  generateMusicKitDeveloperToken(): string | null {
    const teamId = this.configService.get<string>("APPLE_MUSIC_TEAM_ID");
    const keyId = this.configService.get<string>("APPLE_MUSIC_KEY_ID");
    const privateKeyStr = this.configService.get<string>("APPLE_MUSIC_PRIVATE_KEY");

    if (!teamId || !keyId || !privateKeyStr) {
      return null;
    }

    try {
      const privateKey = privateKeyStr.replace(/\\n/g, "\n");
      // MusicKit requires a JOSE ES256 JWT: the ECDSA signature must be the raw
      // r‖s (IEEE P1363) form. Node's crypto.createSign(...).sign() emits an
      // ASN.1 DER signature by default, which Apple rejects with
      // ERROR_FAILED_TO_VERIFY_JWT. Sign with the jsonwebtoken library (as the
      // catalog-lookup path already does) so the encoding is correct.
      const token = jwt.sign({}, privateKey, {
        algorithm: "ES256",
        expiresIn: "180d",
        header: { alg: "ES256", kid: keyId },
        issuer: teamId,
      });
      return token;
    } catch (err) {
      this.logger.error("Failed to generate MusicKit developer token", err);
      return null;
    }
  }

  /**
   * Structural validation of a MusicKit developer token — three JWT segments,
   * ES256 header with a non-empty `kid`, and a payload with a non-empty `iss`
   * (team id) that has not already expired. This catches the common staging
   * misconfiguration (missing/mangled key id or private key) before we hand a
   * broken token to Apple's authorize page, which would otherwise present a
   * generic "Problem Connecting" error to the user.
   */
  isDeveloperTokenWellFormed(token: string | null | undefined): boolean {
    if (!token || typeof token !== "string") return false;
    const segments = token.split(".");
    if (segments.length !== 3) return false;
    try {
      const header = JSON.parse(Buffer.from(segments[0], "base64url").toString("utf8")) as {
        alg?: string;
        kid?: string;
      };
      const payload = JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8")) as {
        iss?: string;
        exp?: number;
      };
      if (header.alg !== "ES256") return false;
      if (!header.kid || typeof header.kid !== "string") return false;
      if (!payload.iss || typeof payload.iss !== "string") return false;
      if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) return false;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Cryptographically verify a MusicKit developer token against the public key
   * derived from the configured `.p8` private key. This catches the exact class
   * of signing bug that produced `ERROR_FAILED_TO_VERIFY_JWT` (e.g. a DER-
   * encoded ECDSA signature instead of JOSE r‖s) *before* the token ever
   * reaches Apple. It cannot detect a wrong Key ID / Team ID (only Apple can),
   * but it guarantees the signature itself is a valid ES256 JOSE signature for
   * this key.
   */
  developerTokenSelfVerifies(token: string | null | undefined): boolean {
    if (!token) return false;
    const privateKeyStr = this.configService.get<string>("APPLE_MUSIC_PRIVATE_KEY");
    if (!privateKeyStr) return false;
    try {
      const privateKey = privateKeyStr.replace(/\\n/g, "\n");
      const publicKey = createPublicKey({ key: privateKey, format: "pem" });
      jwt.verify(token, publicKey, { algorithms: ["ES256"] });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Safe, secret-free report of whether this environment is configured for the
   * music OAuth flows. Returns only booleans (and the non-secret Spotify
   * redirect URI, which is required to match the provider dashboard) so it can
   * be surfaced to an admin to diagnose "connect fails" without leaking any
   * client secrets or signing keys.
   */
  getOAuthConfigDiagnostics(): {
    apiBaseUrl: { configured: boolean; isLocalhost: boolean };
    spotify: {
      clientId: boolean;
      clientSecret: boolean;
      redirectUri: string | null;
      redirectUriHttps: boolean;
      redirectUriCallbackPath: boolean;
      redirectUriValid: boolean;
      redirectUriProblem: string | null;
      ready: boolean;
    };
    appleMusic: {
      authBaseUrlConfigured: boolean;
      authBaseUrlHttps: boolean;
      authBaseUrlUsesRailwayDomain: boolean;
      teamId: boolean;
      keyId: boolean;
      privateKey: boolean;
      developerTokenGenerates: boolean;
      developerTokenWellFormed: boolean;
      developerTokenSelfVerifies: boolean;
      ready: boolean;
    };
  } {
    const apiBaseUrl = this.configService.get<string>("API_BASE_URL");
    const spotifyClientId = Boolean(this.configService.get<string>("SPOTIFY_CLIENT_ID"));
    const spotifyClientSecret = Boolean(this.configService.get<string>("SPOTIFY_CLIENT_SECRET"));
    const spotifyRedirectUri = this.configService.get<string>("SPOTIFY_REDIRECT_URI") ?? null;
    let spotifyRedirectUriHttps = false;
    let spotifyRedirectUriCallbackPath = false;
    if (spotifyRedirectUri) {
      try {
        const parsed = new URL(spotifyRedirectUri);
        spotifyRedirectUriHttps = parsed.protocol === "https:";
        spotifyRedirectUriCallbackPath = parsed.pathname === "/api/auth/spotify/callback";
      } catch {
        // Invalid URLs are reported through redirectUriProblem below.
      }
    }
    // Single source of truth for validity (also catches comma-separated lists).
    const spotifyRedirectUriProblemMessage = spotifyRedirectUriProblem(spotifyRedirectUri);
    const spotifyRedirectUriValid = spotifyRedirectUriProblemMessage === null;

    const teamId = Boolean(this.configService.get<string>("APPLE_MUSIC_TEAM_ID"));
    const keyId = Boolean(this.configService.get<string>("APPLE_MUSIC_KEY_ID"));
    const privateKey = Boolean(this.configService.get<string>("APPLE_MUSIC_PRIVATE_KEY"));
    const appleMusicAuthBaseUrl = this.configService.get<string>("APPLE_MUSIC_AUTH_BASE_URL")?.trim();
    let authBaseUrlHttps = false;
    let authBaseUrlUsesRailwayDomain = false;
    if (appleMusicAuthBaseUrl) {
      try {
        const parsed = new URL(appleMusicAuthBaseUrl);
        authBaseUrlHttps = parsed.protocol === "https:";
        authBaseUrlUsesRailwayDomain = parsed.hostname.endsWith(".up.railway.app");
      } catch {
        // Invalid URLs remain not ready and are reported through the booleans.
      }
    }
    const developerToken = this.generateMusicKitDeveloperToken();
    const developerTokenGenerates = Boolean(developerToken);
    const developerTokenWellFormed = this.isDeveloperTokenWellFormed(developerToken);
    const developerTokenSelfVerifies = this.developerTokenSelfVerifies(developerToken);

    return {
      apiBaseUrl: {
        configured: Boolean(apiBaseUrl),
        isLocalhost: Boolean(apiBaseUrl && /localhost|127\.0\.0\.1/.test(apiBaseUrl)),
      },
      spotify: {
        clientId: spotifyClientId,
        clientSecret: spotifyClientSecret,
        redirectUri: spotifyRedirectUri,
        redirectUriHttps: spotifyRedirectUriHttps,
        redirectUriCallbackPath: spotifyRedirectUriCallbackPath,
        redirectUriValid: spotifyRedirectUriValid,
        redirectUriProblem: spotifyRedirectUriProblemMessage,
        ready: spotifyClientId && spotifyRedirectUriValid,
      },
      appleMusic: {
        authBaseUrlConfigured: Boolean(appleMusicAuthBaseUrl),
        authBaseUrlHttps,
        authBaseUrlUsesRailwayDomain,
        teamId,
        keyId,
        privateKey,
        developerTokenGenerates,
        developerTokenWellFormed,
        developerTokenSelfVerifies,
        // A self-verifiable token guarantees the signature is valid ES256 JOSE
        // for this key — the class of failure behind ERROR_FAILED_TO_VERIFY_JWT.
        ready: Boolean(appleMusicAuthBaseUrl)
          && authBaseUrlHttps
          && !authBaseUrlUsesRailwayDomain
          && teamId
          && keyId
          && privateKey
          && developerTokenSelfVerifies,
      },
    };
  }

  async handleAppleMusicCallback(state: string, userToken: string): Promise<{ success: boolean; message: string }> {
    const { userId } = this.musicConnections
      ? await this.musicConnections.consumeOAuthState(state, "apple-music")
      : { userId: this.verifyOAuthState(state) };

    if (!userToken?.trim()) {
      throw new BadRequestException("Apple Music user token is missing");
    }

    try {
      if (this.musicConnections) {
        await this.musicConnections.connectAppleMusic(userId, userToken);
      } else {
        await this.usersService.connectAppleMusic(userId, userToken);
      }
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw new BadRequestException("Invalid state parameter");
      }
      this.logger.error(`Failed to connect Apple Music for user ${userId}: ${(err as Error).message}`);
      throw new BadRequestException("Failed to connect Apple Music account");
    }

    return { success: true, message: "Apple Music account connected successfully" };
  }

  async buildSpotifyAuthUrl(userId: string): Promise<string> {
    const clientId = this.configService.get<string>("SPOTIFY_CLIENT_ID");
    const redirectUri = this.configService.get<string>("SPOTIFY_REDIRECT_URI");

    if (!clientId || !redirectUri) {
      throw new ServiceUnavailableException(
        "Spotify OAuth is not available. SPOTIFY_CLIENT_ID and SPOTIFY_REDIRECT_URI must be configured.",
      );
    }
    const redirectProblem = spotifyRedirectUriProblem(redirectUri);
    if (redirectProblem) {
      throw new ServiceUnavailableException(`Spotify OAuth is misconfigured: ${redirectProblem}`);
    }

    const codeVerifier = randomBytes(64).toString("base64url");
    const codeChallenge = require("crypto")
      .createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");
    const state = this.musicConnections
      ? await this.musicConnections.createOAuthState(userId, "spotify", codeVerifier)
      : this.signOAuthState(userId);
    const scopes = [
      "user-read-recently-played",
      "user-read-currently-playing",
      "user-top-read",
      "playlist-read-private",
      "playlist-read-collaborative",
    ];

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: scopes.join(" "),
      state,
      code_challenge_method: "S256",
      code_challenge: codeChallenge,
    });

    return `https://accounts.spotify.com/authorize?${params.toString()}`;
  }

  async handleSpotifyCallback(code: string, state: string): Promise<{ success: boolean; message: string }> {
    const clientId = this.configService.get<string>("SPOTIFY_CLIENT_ID");
    const clientSecret = this.configService.get<string>("SPOTIFY_CLIENT_SECRET");
    const redirectUri = this.configService.get<string>("SPOTIFY_REDIRECT_URI");

    if (!clientId || !redirectUri) {
      throw new ServiceUnavailableException(
        "Spotify OAuth is not available. SPOTIFY_CLIENT_ID and SPOTIFY_REDIRECT_URI must be configured.",
      );
    }
    const redirectProblem = spotifyRedirectUriProblem(redirectUri);
    if (redirectProblem) {
      // Must match the authorize call byte-for-byte; fail fast rather than let
      // Spotify reject the token exchange with an opaque error.
      throw new ServiceUnavailableException(`Spotify OAuth is misconfigured: ${redirectProblem}`);
    }

    const oauthState = this.musicConnections
      ? await this.musicConnections.consumeOAuthState(state, "spotify")
      : { userId: this.verifyOAuthState(state), codeVerifier: null };

    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };
    if (clientSecret) {
      headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
    }

    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      ...(oauthState.codeVerifier ? { code_verifier: oauthState.codeVerifier } : {}),
      ...(!clientSecret ? { client_id: clientId } : {}),
    });
    const tokenResponse = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(12_000),
      body: tokenBody.toString(),
    });

    if (!tokenResponse.ok) {
      const providerError = await tokenResponse
        .json()
        .catch(() => ({})) as { error?: string; error_description?: string };
      const providerErrorCode = typeof providerError.error === "string"
        ? providerError.error.slice(0, 80)
        : "unknown";
      this.logger.error(
        `Spotify token exchange failed status=${tokenResponse.status} providerError=${providerErrorCode}`,
      );

      if (providerErrorCode === "invalid_client") {
        throw new BadRequestException({
          errorCode: "SPOTIFY_CONFIGURATION_INVALID",
          message: "Spotify is not configured correctly for this environment.",
        });
      }
      if (providerErrorCode === "invalid_grant") {
        throw new BadRequestException({
          errorCode: "SPOTIFY_AUTHORIZATION_EXPIRED",
          message: "This Spotify authorization expired or was already used. Start the connection again.",
        });
      }
      throw new BadRequestException({
        errorCode: "SPOTIFY_TOKEN_EXCHANGE_FAILED",
        message: "Spotify could not complete the authorization. Please try again.",
      });
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope?: string;
    };

    try {
      if (this.musicConnections) {
        await this.musicConnections.connectSpotify(oauthState.userId, tokenData);
      } else if (tokenData.refresh_token) {
        await this.usersService.connectSpotify(oauthState.userId, tokenData.refresh_token);
      } else {
        throw new BadRequestException("Spotify did not return a refresh token.");
      }
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw new BadRequestException("Invalid state parameter");
      }
      if (err instanceof HttpException) {
        throw err;
      }
      this.logger.error(`Failed to save Spotify authorization for user ${oauthState.userId}: ${(err as Error).message}`);
      throw new BadRequestException("Failed to connect Spotify account");
    }

    return { success: true, message: "Spotify account connected successfully" };
  }
}
