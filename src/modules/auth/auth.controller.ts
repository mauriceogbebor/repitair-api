import { Body, Controller, Get, Post, Query, Redirect, UseGuards } from "@nestjs/common";

import { CurrentUser, CurrentUserPayload } from "../../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { AuthService } from "./auth.service";
import { ForgotPasswordDto } from "./dto/forgot-password.dto";
import { LoginDto } from "./dto/login.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";
import { SignupDto } from "./dto/signup.dto";
import { SocialAuthDto } from "./dto/social-auth.dto";
import { VerifyCodeDto } from "./dto/verify-code.dto";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private buildSpotifyAppRedirect(
    status: "success" | "error",
    message?: string,
  ) {
    const params = new URLSearchParams({ status });
    if (message) {
      params.set("message", message);
    }
    return { url: `repitair://spotify-connected?${params.toString()}` };
  }

  @Post("signup")
  signup(@Body() body: SignupDto) {
    return this.authService.signup(body);
  }

  @Post("login")
  login(@Body() body: LoginDto) {
    return this.authService.login(body);
  }

  @Post("social")
  socialAuth(@Body() body: SocialAuthDto) {
    return this.authService.socialAuth(body);
  }

  @Post("forgot-password")
  forgotPassword(@Body() body: ForgotPasswordDto) {
    return this.authService.forgotPassword(body.email);
  }

  @Post("verify-code")
  verifyCode(@Body() body: VerifyCodeDto) {
    return this.authService.verifyCode(body.email, body.code);
  }

  @Post("reset-password")
  resetPassword(@Body() body: ResetPasswordDto) {
    return this.authService.resetPassword(body.email, body.resetToken, body.newPassword);
  }

  /**
   * Logout — requires a valid token, blacklists it server-side.
   * Token comes from the Authorization header (validated by JwtAuthGuard),
   * not from the request body, so clients can't accidentally log out a
   * different user by passing the wrong token.
   */
  @Post("logout")
  @UseGuards(JwtAuthGuard)
  logout(@CurrentUser() user: CurrentUserPayload) {
    return this.authService.logout(user.token);
  }

  /**
   * Refresh — exchange a still-valid access token for a new one.
   * The old token is blacklisted to prevent reuse.
   */
  @Post("refresh")
  @UseGuards(JwtAuthGuard)
  refresh(@CurrentUser() user: CurrentUserPayload) {
    return this.authService.refresh(user.token, user.sub, user.email);
  }

  /**
   * Initiate Spotify OAuth flow.
   * Returns the Spotify authorization URL that the mobile app should open in a browser.
   * Requires the user to be logged in (JwtAuthGuard).
   */
  @Get("spotify/redirect")
  @UseGuards(JwtAuthGuard)
  spotifyRedirect(@CurrentUser() user: CurrentUserPayload) {
    const url = this.authService.buildSpotifyAuthUrl(user.sub);
    return { url };
  }

  /**
   * Spotify OAuth callback.
   * Public endpoint — Spotify redirects the browser here with the authorization code.
   * After exchanging the code for tokens, redirects to a deep link for the mobile app.
   */
  @Get("spotify/callback")
  @Redirect()
  async spotifyCallback(
    @Query("code") code?: string,
    @Query("state") state?: string,
    @Query("error") error?: string,
  ) {
    if (error) {
      const message =
        error === "access_denied"
          ? "Spotify connection was cancelled."
          : "Could not connect Spotify. Please try again.";
      return this.buildSpotifyAppRedirect("error", message);
    }

    if (!code || !state) {
      return this.buildSpotifyAppRedirect(
        "error",
        "Could not connect Spotify. Please try again.",
      );
    }

    try {
      await this.authService.handleSpotifyCallback(code, state);
      return this.buildSpotifyAppRedirect("success");
    } catch (err) {
      const message =
        err instanceof Error && err.message.includes("not available")
          ? "Spotify connection is not available right now."
          : err instanceof Error && err.message.includes("Invalid state")
            ? "This Spotify connection link is invalid or expired."
            : "Could not connect Spotify. Please try again.";
      return this.buildSpotifyAppRedirect("error", message);
    }
  }
}
