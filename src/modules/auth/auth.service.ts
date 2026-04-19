import { Injectable, UnauthorizedException, Logger, BadRequestException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";

import { UsersService } from "../users/users.service";
import { MailService } from "../../common/services/mail.service";
import { TokenBlacklistService } from "../../common/services/token-blacklist.service";
import { LoginDto } from "./dto/login.dto";
import { SignupDto } from "./dto/signup.dto";

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
    private readonly tokenBlacklist: TokenBlacklistService,
    private readonly configService: ConfigService,
  ) {}

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
      },
    };
  }

  async forgotPassword(email: string) {
    const code = await this.usersService.setResetCode(email);
    const user = await this.usersService.findByEmail(email);
    if (code && user) {
      try {
        await this.mailService.sendPasswordResetCode(email, code, user.fullName);
      } catch (err) {
        this.logger.error(`Failed to send reset email to ${email}: ${(err as Error).message}`);
        // Don't leak email failure to the caller — preserve enumeration resistance.
      }
    }
    // Always return the same response whether or not the email exists,
    // to prevent account enumeration.
    return {
      message: "If that email exists, a verification code has been sent",
    };
  }

  async verifyCode(email: string, code: string) {
    const valid = await this.usersService.verifyResetCode(email, code);
    if (!valid) {
      throw new UnauthorizedException("Invalid or expired code");
    }
    return { verified: true };
  }

  async resetPassword(email: string, newPassword: string) {
    const success = await this.usersService.resetPassword(email, newPassword);
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

  private signToken(userId: string, email: string): string {
    return this.jwtService.sign({ sub: userId, email });
  }

  /**
   * Build the Spotify authorization URL for the user to visit.
   * Encodes the user's ID in the state parameter for retrieval on callback.
   */
  buildSpotifyAuthUrl(userId: string): string {
    const clientId = this.configService.get<string>("SPOTIFY_CLIENT_ID");
    const redirectUri = this.configService.get<string>("SPOTIFY_REDIRECT_URI");

    if (!clientId || !redirectUri) {
      throw new Error("Spotify OAuth credentials not configured");
    }

    // Encode user ID in the state parameter (base64) so we can identify them on callback
    const state = Buffer.from(userId).toString("base64");
    const scopes = ["user-read-recently-played", "user-read-currently-playing", "user-top-read"];

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
   * Expects state to contain the user ID encoded in base64.
   */
  async handleSpotifyCallback(code: string, state: string): Promise<{ success: boolean; message: string }> {
    const clientId = this.configService.get<string>("SPOTIFY_CLIENT_ID");
    const clientSecret = this.configService.get<string>("SPOTIFY_CLIENT_SECRET");
    const redirectUri = this.configService.get<string>("SPOTIFY_REDIRECT_URI");

    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error("Spotify OAuth credentials not configured");
    }

    // Decode state to get user ID
    let userId: string;
    try {
      userId = Buffer.from(state, "base64").toString("utf8");
    } catch (err) {
      throw new BadRequestException("Invalid state parameter");
    }

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
      this.logger.error(`Failed to save Spotify refresh token for user ${userId}: ${(err as Error).message}`);
      throw new BadRequestException("Failed to connect Spotify account");
    }

    return { success: true, message: "Spotify account connected successfully" };
  }
}
