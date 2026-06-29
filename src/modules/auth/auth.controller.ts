import { Body, Controller, Get, Header, Post, Query, Redirect, Res, UseGuards } from "@nestjs/common";
import { Response } from "express";

import { CurrentUser, CurrentUserPayload } from "../../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { AuthService } from "./auth.service";
import { ForgotPasswordDto } from "./dto/forgot-password.dto";
import { LoginDto } from "./dto/login.dto";
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
   * Initiate Apple Music connection flow.
   * Returns the URL for the MusicKit JS authorization page.
   */
  @Get("apple-music/redirect")
  @UseGuards(JwtAuthGuard)
  appleMusicRedirect(@CurrentUser() user: CurrentUserPayload) {
    const url = this.authService.buildAppleMusicAuthUrl(user.sub);
    return { url };
  }

  /**
   * Serves an HTML page with MusicKit JS that asks the user to authorize
   * Apple Music access. On success, posts back to the callback endpoint.
   */
  @Get("apple-music/authorize")
  appleMusicAuthorize(
    @Query("state") state: string,
    @Res() res: Response,
  ) {
    const developerToken = this.authService.generateMusicKitDeveloperToken();

    if (!developerToken || !state) {
      const redirectUrl = this.buildAppleMusicAppRedirect(
        "error",
        "Apple Music is not available right now.",
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
    const CALLBACK_URL = window.location.origin + '/auth/apple-music/callback';

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

        // Redirect to callback with the state
        window.location.href = CALLBACK_URL + '?state=' + encodeURIComponent(STATE) + '&userToken=' + encodeURIComponent(userToken);
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
  @Get("apple-music/callback")
  async appleMusicCallback(
    @Query("state") state?: string,
    @Query("userToken") userToken?: string,
    @Query("error") error?: string,
    @Res() res?: Response,
  ) {
    if (error || !state || !userToken) {
      const redirectUrl = this.buildAppleMusicAppRedirect(
        "error",
        "Could not connect Apple Music. Please try again.",
      );
      return res!.redirect(redirectUrl);
    }

    try {
      await this.authService.handleAppleMusicCallback(state, userToken);
      const redirectUrl = this.buildAppleMusicAppRedirect("success");
      return res!.redirect(redirectUrl);
    } catch (err) {
      const message =
        err instanceof Error && err.message.includes("not available")
          ? "Apple Music connection is not available right now."
          : err instanceof Error && err.message.includes("Invalid state")
            ? "This Apple Music connection link is invalid or expired."
            : "Could not connect Apple Music. Please try again.";
      const redirectUrl = this.buildAppleMusicAppRedirect("error", message);
      return res!.redirect(redirectUrl);
    }
  }
}
