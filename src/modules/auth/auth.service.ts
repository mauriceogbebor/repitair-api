import {
  Injectable,
  UnauthorizedException,
  Logger,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { createHmac, createPublicKey, randomBytes, timingSafeEqual } from "crypto";

import { UsersService } from "../users/users.service";
import { MailService } from "../../common/services/mail.service";
import { TokenBlacklistService } from "../../common/services/token-blacklist.service";
import { LoginDto } from "./dto/login.dto";
import { SignupDto } from "./dto/signup.dto";
import { SocialAuthDto } from "./dto/social-auth.dto";

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
  ) {}

  /** Return a required config value or throw at runtime. */
  private requireSecret(key: string): string {
    const value = this.configService.get<string>(key);
    if (!value) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
  }

  async signup(dto: SignupDto) {
    const user = await this.usersService.createUser({
      fullName: dto.fullName,
      email: dto.email,
      password: dto.password,
      country: dto.country ?? "",
    });

    const token = this.signToken(user.id, user.email);

    return {
      token,
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

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException("Invalid email or password");
    }

    const valid = await this.usersService.validatePassword(user, dto.password);
    if (!valid) {
      throw new UnauthorizedException("Invalid email or password");
    }

    const token = this.signToken(user.id, user.email);

    return {
      token,
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

  /**
   * Social auth — Sign in with Apple or Google.
   * Verifies the ID token, creates the user if they don't exist,
   * and returns a JWT + user payload.
   */
  async socialAuth(dto: SocialAuthDto) {
    let email: string;
    let fullName: string;

    if (dto.provider === "google") {
      const payload = await this.verifyGoogleIdToken(dto.idToken);
      email = payload.email;
      fullName = dto.fullName || payload.name || this.deriveDisplayNameFromEmail(email);
    } else {
      const payload = await this.verifyAppleIdToken(dto.idToken);
      email = payload.email;
      // Apple only sends the name on first sign-in
      fullName = dto.fullName || this.deriveDisplayNameFromEmail(email);
    }

    // Find or create user
    let user = await this.usersService.findByEmail(email);
    if (!user) {
      // Create with a cryptographically random password (social auth users don't use password login)
      const randomPassword = randomBytes(32).toString("base64url");
      user = await this.usersService.createUser({
        fullName,
        email,
        password: randomPassword,
        country: "",
      });
    }

    const token = this.signToken(user.id, user.email);

    return {
      token,
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

private deriveDisplayNameFromEmail(email: string): string {
  const base = email.split("@")[0]?.trim();
  if (!base) return "Repitair User";

  const words = base
    .split(/[._-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));

  return words.length ? words.join(" ") : "Repitair User";
}

  /**
   * Verify Google ID token using Google's tokeninfo endpoint.
   */
  private async verifyGoogleIdToken(idToken: string): Promise<{ email: string; name?: string }> {
    const expectedClientIds = [
      this.configService.get<string>("GOOGLE_CLIENT_ID"),
      this.configService.get<string>("GOOGLE_IOS_CLIENT_ID"),
      this.configService.get<string>("GOOGLE_ANDROID_CLIENT_ID"),
    ].filter((value): value is string => Boolean(value));

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
      const payload = await response.json() as { email?: string; name?: string; aud?: string };

      if (!payload.aud || !expectedClientIds.includes(payload.aud)) {
        throw new UnauthorizedException("Google token audience mismatch");
      }

      if (!payload.email) {
        throw new UnauthorizedException("Google token missing email");
      }

      return { email: payload.email, name: payload.name };
    } catch (error) {
      if (error instanceof UnauthorizedException || error instanceof ServiceUnavailableException) throw error;
      this.logger.error("Google token verification failed", error);
      throw new UnauthorizedException("Failed to verify Google ID token");
    }
  }

  /**
   * Verify Apple ID token by decoding the JWT and validating against Apple's public keys.
   * Uses Apple's JWKS endpoint for key verification.
   */
  private async verifyAppleIdToken(idToken: string): Promise<{ email: string }> {
    const expectedClientId = this.configService.get<string>("APPLE_CLIENT_ID");
    if (!expectedClientId) {
      throw new ServiceUnavailableException(
        "Apple Sign In is not available. APPLE_CLIENT_ID must be configured.",
      );
    }

    try {
      // Decode the token header to get the key ID
      const headerB64 = idToken.split(".")[0];
      const header = JSON.parse(Buffer.from(headerB64, "base64").toString()) as { kid: string; alg: string };

      // Fetch Apple's public keys
      const keysResponse = await fetch("https://appleid.apple.com/auth/keys");
      if (!keysResponse.ok) {
        throw new UnauthorizedException("Failed to fetch Apple public keys");
      }
      const keysData = await keysResponse.json() as { keys: Array<{ kid: string; kty: string; use: string; n: string; e: string }> };

      const appleKey = keysData.keys.find(k => k.kid === header.kid);
      if (!appleKey) {
        throw new UnauthorizedException("Apple key not found for token");
      }

      // Build the public key
      const publicKey = createPublicKey({
        key: {
          kty: appleKey.kty,
          n: appleKey.n,
          e: appleKey.e,
        },
        format: "jwk",
      });

      // Verify the token using NestJS JwtService with the Apple public key
      // Export to PEM string since JwtService expects string | Buffer
      const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }) as string;
      const payload = this.jwtService.verify(idToken, {
        algorithms: [header.alg as "RS256" | "ES256"],
        publicKey: publicKeyPem,
        issuer: "https://appleid.apple.com",
        audience: expectedClientId,
      }) as { email?: string; sub?: string };

      if (!payload.email) {
        throw new UnauthorizedException("Apple token missing email");
      }

      return { email: payload.email };
    } catch (error) {
      if (error instanceof UnauthorizedException || error instanceof ServiceUnavailableException) throw error;
      this.logger.error("Apple token verification failed", error);
      throw new UnauthorizedException("Failed to verify Apple ID token");
    }
  }

  async forgotPassword(email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const code = await this.usersService.setResetCode(normalizedEmail);
    const user = await this.usersService.findByEmail(normalizedEmail);
    if (code && user) {
      try {
        await Promise.race([
          this.mailService.sendPasswordResetCode(normalizedEmail, code, user.fullName),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error("Password reset email delivery timed out")), this.resetEmailDeliveryTimeoutMs);
          }),
        ]);
      } catch (err) {
        this.logger.error(`Failed to send reset email to ${normalizedEmail}: ${(err as Error).message}`);
        // Don't leak email failure to the caller — preserve enumeration resistance.
      }
    } else {
      this.logger.warn(`Password reset requested for unknown email: ${normalizedEmail}`);
    }
    // Always return the same response whether or not the email exists,
    // to prevent account enumeration.
    return {
      message: "If that email exists, a verification code has been sent",
    };
  }

  async verifyCode(email: string, code: string) {
    const resetToken = await this.usersService.verifyResetCode(email, code);
    if (!resetToken) {
      throw new UnauthorizedException("Invalid or expired code");
    }
    // Return the reset token — the client must include it when calling reset-password
    return { verified: true, resetToken };
  }

  async resetPassword(email: string, resetToken: string, newPassword: string) {
    const success = await this.usersService.resetPassword(email, resetToken, newPassword);
    if (!success) {
      throw new UnauthorizedException("Could not reset password");
    }
    return { message: "Password has been reset successfully" };
  }

  async logout(token: string) {
    // Decode (not verify — already verified by the guard) to pull the exp claim
    // so we only keep the token blacklisted until its natural expiry.
    try {
      const decoded = this.jwtService.decode(token) as { exp?: number } | null;
      await this.tokenBlacklist.add(token, decoded?.exp);
    } catch {
      // If decode fails for any reason, blacklist with default expiry.
      await this.tokenBlacklist.add(token);
    }
    return { message: "Logged out successfully" };
  }

  /**
   * Refresh — issue a new access token if the current one is still valid.
   * The old token is blacklisted to prevent reuse.
   */
  async refresh(currentToken: string, userId: string, email: string) {
    // Blacklist the old token so it can't be reused
    try {
      const decoded = this.jwtService.decode(currentToken) as { exp?: number } | null;
      await this.tokenBlacklist.add(currentToken, decoded?.exp);
    } catch {
      // If decode fails, blacklist with default expiry
      await this.tokenBlacklist.add(currentToken);
    }

    const token = this.signToken(userId, email);

    // Include user data so the client can update its local state
    const user = await this.usersService.findById(userId);
    return {
      token,
      user: user
        ? {
            id: user.id,
            fullName: user.fullName,
            email: user.email,
            country: user.country,
            connectedPlatforms: user.connectedPlatforms,
            avatarUrl: user.avatarUrl ?? null,
          }
        : undefined,
    };
  }

  /**
   * Send an email verification code to the user.
   */
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

  /**
   * Verify the email verification code.
   */
  async verifyEmail(userId: string, code: string) {
    const success = await this.usersService.verifyEmail(userId, code);
    if (!success) {
      throw new BadRequestException("Invalid or expired verification code");
    }
    return { verified: true };
  }

  private signToken(userId: string, email: string): string {
    return this.jwtService.sign({ sub: userId, email });
  }

  /**
   * Build an HMAC-signed state parameter: "base64(userId).hmac"
   * so the callback can verify it wasn't forged.
   */
  private signOAuthState(userId: string): string {
    const secret = this.requireSecret("JWT_SECRET");
    const payload = Buffer.from(userId).toString("base64url");
    const sig = createHmac("sha256", secret).update(payload).digest("base64url");
    return `${payload}.${sig}`;
  }

  /**
   * Verify and decode an HMAC-signed state parameter.
   * Returns the userId or throws on tampered/invalid state.
   */
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

  /**
   * Build the Apple Music authorization URL.
   * Serves a backend-hosted page that uses MusicKit JS to request user authorization.
   * The signed state parameter encodes the user ID for the callback.
   */
  buildAppleMusicAuthUrl(userId: string): string {
    const teamId = this.configService.get<string>("APPLE_MUSIC_TEAM_ID");
    const keyId = this.configService.get<string>("APPLE_MUSIC_KEY_ID");
    const privateKeyStr = this.configService.get<string>("APPLE_MUSIC_PRIVATE_KEY");

    if (!teamId || !keyId || !privateKeyStr) {
      throw new ServiceUnavailableException(
        "Apple Music is not available. APPLE_MUSIC_TEAM_ID, APPLE_MUSIC_KEY_ID, and APPLE_MUSIC_PRIVATE_KEY must be configured.",
      );
    }

    const state = this.signOAuthState(userId);

    const baseUrl = this.configService.get<string>("API_BASE_URL") || "http://localhost:3000";
    const params = new URLSearchParams({ state });
    return `${baseUrl}/auth/apple-music/authorize?${params.toString()}`;
  }

  /**
   * Generate a MusicKit developer token (JWT signed with ES256).
   * This token is used client-side by MusicKit JS to authenticate with Apple.
   */
  generateMusicKitDeveloperToken(): string | null {
    const teamId = this.configService.get<string>("APPLE_MUSIC_TEAM_ID");
    const keyId = this.configService.get<string>("APPLE_MUSIC_KEY_ID");
    const privateKeyStr = this.configService.get<string>("APPLE_MUSIC_PRIVATE_KEY");

    if (!teamId || !keyId || !privateKeyStr) {
      return null;
    }

    try {
      const privateKey = privateKeyStr.replace(/\\n/g, "\n");
      const now = Math.floor(Date.now() / 1000);
      const exp = now + 6 * 30 * 24 * 60 * 60; // 6 months

      const header = { alg: "ES256", kid: keyId, typ: "JWT" };
      const payload = { iss: teamId, iat: now, exp };

      const headerEnc = Buffer.from(JSON.stringify(header)).toString("base64url");
      const payloadEnc = Buffer.from(JSON.stringify(payload)).toString("base64url");
      const message = `${headerEnc}.${payloadEnc}`;

      const { createSign } = require("crypto");
      const sig = createSign("sha256").update(message).sign({ key: privateKey, format: "pem" }, "base64");
      const sigEnc = Buffer.from(sig, "base64").toString("base64url");

      return `${message}.${sigEnc}`;
    } catch (err) {
      this.logger.error("Failed to generate MusicKit developer token", err);
      return null;
    }
  }

  /**
   * Handle Apple Music authorization callback.
   * Marks the user as connected to Apple Music.
   */
  async handleAppleMusicCallback(
    state: string,
    userToken: string,
  ): Promise<{ success: boolean; message: string }> {
    const userId = this.verifyOAuthState(state);

    if (!userToken?.trim()) {
      throw new BadRequestException("Apple Music user token is missing");
    }

    try {
      await this.usersService.connectAppleMusic(userId, userToken);
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw new BadRequestException("Invalid state parameter");
      }
      this.logger.error(`Failed to connect Apple Music for user ${userId}: ${(err as Error).message}`);
      throw new BadRequestException("Failed to connect Apple Music account");
    }

    return { success: true, message: "Apple Music account connected successfully" };
  }

  /**
   * Build the Spotify authorization URL for the user to visit.
   * Encodes the user's ID in a signed state parameter for retrieval on callback.
   */
  buildSpotifyAuthUrl(userId: string): string {
    const clientId = this.configService.get<string>("SPOTIFY_CLIENT_ID");
    const redirectUri = this.configService.get<string>("SPOTIFY_REDIRECT_URI");

    if (!clientId || !redirectUri) {
      throw new ServiceUnavailableException(
        "Spotify OAuth is not available. SPOTIFY_CLIENT_ID and SPOTIFY_REDIRECT_URI must be configured.",
      );
    }

    const state = this.signOAuthState(userId);
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
    });

    return `https://accounts.spotify.com/authorize?${params.toString()}`;
  }

  /**
   * Exchange Spotify authorization code for tokens and save refresh token to user.
   * Validates the HMAC-signed state to extract the user ID.
   */
  async handleSpotifyCallback(code: string, state: string): Promise<{ success: boolean; message: string }> {
    const clientId = this.configService.get<string>("SPOTIFY_CLIENT_ID");
    const clientSecret = this.configService.get<string>("SPOTIFY_CLIENT_SECRET");
    const redirectUri = this.configService.get<string>("SPOTIFY_REDIRECT_URI");

    if (!clientId || !clientSecret || !redirectUri) {
      throw new ServiceUnavailableException(
        "Spotify OAuth is not available. SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, and SPOTIFY_REDIRECT_URI must be configured.",
      );
    }

    // Verify HMAC-signed state and extract user ID
    const userId = this.verifyOAuthState(state);

    // Exchange code for tokens
    const tokenResponse = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }).toString(),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.json();
      this.logger.error(`Spotify token exchange failed: ${JSON.stringify(error)}`);
      throw new BadRequestException("Failed to exchange authorization code for tokens");
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    // Save the refresh token to the user
    try {
      await this.usersService.connectSpotify(userId, tokenData.refresh_token);
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw new BadRequestException("Invalid state parameter");
      }
      this.logger.error(`Failed to save Spotify refresh token for user ${userId}: ${(err as Error).message}`);
      throw new BadRequestException("Failed to connect Spotify account");
    }

    return { success: true, message: "Spotify account connected successfully" };
  }
}
