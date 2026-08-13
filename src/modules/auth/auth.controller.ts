import { BadRequestException, Body, Controller, Delete, Get, Header, Param, Post, Query, Redirect, Res, UseGuards } from "@nestjs/common";
import { Response } from "express";

import { CurrentUser, CurrentUserPayload } from "../../common/decorators/current-user.decorator";
import { AdminEmailGuard } from "../../common/guards/admin-email.guard";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { AuthService } from "./auth.service";
import { ForgotPasswordDto } from "./dto/forgot-password.dto";
import { LoginDto } from "./dto/login.dto";
import { LogoutDto } from "./dto/logout.dto";
import { RefreshSessionDto } from "./dto/refresh-session.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";
import { SignupDto } from "./dto/signup.dto";
import { SocialAuthDto } from "./dto/social-auth.dto";
import { VerifyCodeDto } from "./dto/verify-code.dto";
import { VerifyEmailDto } from "./dto/verify-email.dto";

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

  /**
   * Link a social provider to the currently-authenticated Repitair account
   * (the "Connect account" flow). Rejects if already linked elsewhere.
   */
  @Post("social/link")
  @UseGuards(JwtAuthGuard)
  linkSocial(@CurrentUser() user: CurrentUserPayload, @Body() body: SocialAuthDto) {
    return this.authService.linkSocialProvider(user.sub, body);
  }

  /** The authentication methods (password / google / apple) linked to the user. */
  @Get("social/providers")
  @UseGuards(JwtAuthGuard)
  authProviders(@CurrentUser() user: CurrentUserPayload) {
    return this.authService.getLinkedAuthProviders(user.sub);
  }

  /**
   * Disconnect a social provider from the current account (the "Disconnect"
   * action). Rejects if it would remove the user's last sign-in method.
   */
  @Delete("social/:provider")
  @UseGuards(JwtAuthGuard)
  unlinkSocial(
    @CurrentUser() user: CurrentUserPayload,
    @Param("provider") provider: string,
  ) {
    if (provider !== "google" && provider !== "apple") {
      throw new BadRequestException("Unsupported provider.");
    }
    return this.authService.unlinkSocialProvider(user.sub, provider);
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
  logout(@CurrentUser() user: CurrentUserPayload, @Body() body: LogoutDto) {
    return this.authService.logout(user.token, body.refreshToken);
  }

  /**
   * Refresh — rotate a refresh session independently of access-token expiry.
   */
  @Post("refresh")
  refresh(@Body() body: RefreshSessionDto) {
    return this.authService.refresh(body.refreshToken);
  }

  /** Upgrade a pre-refresh-token mobile session without forcing a new login. */
  @Post("upgrade-session")
  @UseGuards(JwtAuthGuard)
  upgradeSession(@CurrentUser() user: CurrentUserPayload) {
    return this.authService.upgradeSession(user.token, user.sub);
  }

  /**
   * Send a verification code to the current user's email.
   */
  @Post("send-verify-email")
  @UseGuards(JwtAuthGuard)
  sendVerifyEmail(@CurrentUser() user: CurrentUserPayload) {
    return this.authService.sendEmailVerification(user.sub, user.email);
  }

  /**
   * Verify the email verification code.
   */
  @Post("verify-email")
  @UseGuards(JwtAuthGuard)
  verifyEmail(@CurrentUser() user: CurrentUserPayload, @Body() body: VerifyEmailDto) {
    return this.authService.verifyEmail(user.sub, body.code);
  }

  /**
   * Initiate Spotify OAuth flow.
   * Returns the Spotify authorization URL that the mobile app should open in a browser.
   * Requires the user to be logged in (JwtAuthGuard).
   */
  @Get("spotify/redirect")
  @UseGuards(JwtAuthGuard)
  async spotifyRedirect(@CurrentUser() user: CurrentUserPayload) {
    const url = await this.authService.buildSpotifyAuthUrl(user.sub);
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

  // ─── Apple Music ──────────────────────────────────────────

  private buildAppleMusicAppRedirect(
    status: "success" | "error",
    message?: string,
  ) {
    const params = new URLSearchParams({ status });
    if (message) {
      params.set("message", message);
    }
    return `repitair://apple-music-connected?${params.toString()}`;
  }

  /**
   * Admin-only, secret-free readiness report for the music OAuth flows.
   * Lets an operator instantly see which env vars are missing/misconfigured on
   * a given deployment (e.g. staging) when "connect" fails, instead of chasing
   * a generic provider "Problem Connecting" screen. Returns booleans only
   * (plus the non-secret Spotify redirect URI, which must match the dashboard).
   */
  @Get("oauth/diagnostics")
  @UseGuards(JwtAuthGuard, AdminEmailGuard)
  oauthDiagnostics() {
    return this.authService.getOAuthConfigDiagnostics();
  }

  /**
   * Initiate Apple Music connection flow.
   * Returns the URL for the MusicKit JS authorization page.
   */
  @Get("apple-music/redirect")
  @UseGuards(JwtAuthGuard)
  async appleMusicRedirect(@CurrentUser() user: CurrentUserPayload) {
    const url = await this.authService.buildAppleMusicAuthUrl(user.sub);
    return { url };
  }

  /**
   * Serves an HTML page with MusicKit JS that asks the user to authorize
   * Apple Music access. On success, posts back to the callback endpoint.
   */
  @Get("apple-music/authorize")
  async appleMusicAuthorize(
    @Query("state") state: string,
    @Res() res: Response,
  ) {
    try {
      await this.authService.validateAppleMusicAuthorizationState(state);
    } catch {
      return res.redirect(
        this.buildAppleMusicAppRedirect(
          "error",
          "This Apple Music connection link is invalid or expired.",
        ),
      );
    }
    const developerToken = this.authService.generateMusicKitDeveloperToken();

    // Fail loudly on a missing OR structurally-invalid developer token — the
    // common staging misconfiguration (missing/mangled APPLE_MUSIC_* env). This
    // prevents handing Apple a broken token that surfaces as a confusing
    // "Problem Connecting / network issue" on authorize.music.apple.com.
    if (!state || !developerToken || !this.authService.isDeveloperTokenWellFormed(developerToken)) {
      const redirectUrl = this.buildAppleMusicAppRedirect(
        "error",
        "Apple Music isn't configured on this server yet. Please try again later.",
      );
      return res.redirect(redirectUrl);
    }

    // Serve inline HTML page with MusicKit JS
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Connect Apple Music</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0A1A0F;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 24px;
    }
    .card {
      background: #142118;
      border-radius: 20px;
      padding: 40px 32px;
      text-align: center;
      max-width: 380px;
      width: 100%;
    }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 8px; }
    p { color: #8F9590; font-size: 15px; line-height: 1.5; margin-bottom: 28px; }
    .btn {
      background: #FC3C44;
      color: #fff;
      border: none;
      border-radius: 999px;
      padding: 14px 32px;
      font-size: 17px;
      font-weight: 600;
      cursor: pointer;
      width: 100%;
      transition: opacity 0.2s;
    }
    .btn:hover { opacity: 0.9; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .status { margin-top: 16px; font-size: 14px; color: #8F9590; }
    .error { color: #FF6B6B; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">\u{1F3B5}</div>
    <h1>Connect Apple Music</h1>
    <p>Tap the button below to authorize Repitair to access your Apple Music account.</p>
    <button class="btn" id="authBtn" onclick="authorize()">Authorize Apple Music</button>
    <div class="status" id="status"></div>
  </div>

  <script src="https://js-cdn.music.apple.com/musickit/v3/musickit.js" data-web-components crossorigin></script>
  <script>
    const STATE = ${JSON.stringify(state)};
    const DEV_TOKEN = ${JSON.stringify(developerToken)};
    const CALLBACK_URL = new URL('callback', window.location.href).toString();

    async function authorize() {
      const btn = document.getElementById('authBtn');
      const status = document.getElementById('status');
      btn.disabled = true;
      btn.textContent = 'Authorizing...';
      status.textContent = '';

      try {
        await MusicKit.configure({
          developerToken: DEV_TOKEN,
          app: { name: 'Repitair', build: '1.0.0' },
        });

        const music = MusicKit.getInstance();
        const userToken = await music.authorize();

        if (!userToken) {
          throw new Error('Authorization was cancelled.');
        }

        const callback = await fetch(CALLBACK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: STATE, userToken }),
        });
        const result = await callback.json();
        if (!callback.ok || !result.redirectUrl) {
          throw new Error(result.message || 'Authorization failed. Please try again.');
        }
        window.location.replace(result.redirectUrl);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Try Again';
        status.className = 'status error';
        status.textContent = err.message || 'Authorization failed. Please try again.';
      }
    }
  </script>
</body>
</html>`;

    res.type("text/html").send(html);
  }

  /**
   * Apple Music OAuth callback.
   * Called after the user authorizes on the MusicKit JS page.
   * Marks the user as connected and redirects to the mobile app.
   */
  @Post("apple-music/callback")
  async appleMusicCallback(
    @Body() body: { state?: string; userToken?: string; error?: string },
  ) {
    const { state, userToken, error } = body;
    if (error || !state || !userToken) {
      return {
        redirectUrl: this.buildAppleMusicAppRedirect("error", "Could not connect Apple Music. Please try again."),
      };
    }

    try {
      await this.authService.handleAppleMusicCallback(state, userToken);
      return { redirectUrl: this.buildAppleMusicAppRedirect("success") };
    } catch (err) {
      const message =
        err instanceof Error && err.message.includes("not available")
          ? "Apple Music connection is not available right now."
          : err instanceof Error && err.message.includes("Invalid state")
            ? "This Apple Music connection link is invalid or expired."
            : "Could not connect Apple Music. Please try again.";
      return { redirectUrl: this.buildAppleMusicAppRedirect("error", message) };
    }
  }
}
