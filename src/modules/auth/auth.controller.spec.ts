import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { TokenBlacklistService } from "../../common/services/token-blacklist.service";
import { getRepositoryToken } from "@nestjs/typeorm";
import { User } from "../../entities";

describe("AuthController", () => {
  let authController: AuthController;
  let authService: AuthService;

  const mockAuthResponse = {
    token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    user: {
      id: "user_1",
      fullName: "John Doe",
      email: "john@example.com",
      country: "US",
      connectedPlatforms: [],
    },
  };

  beforeEach(async () => {
    const mockAuthService = {
      signup: jest.fn(),
      login: jest.fn(),
      socialAuth: jest.fn(),
      forgotPassword: jest.fn(),
      verifyCode: jest.fn(),
      resetPassword: jest.fn(),
      logout: jest.fn(),
      refresh: jest.fn(),
      upgradeSession: jest.fn(),
      buildSpotifyAuthUrl: jest.fn(),
      handleSpotifyCallback: jest.fn(),
      validateAppleMusicAuthorizationState: jest.fn(),
      generateMusicKitDeveloperToken: jest.fn(),
      isDeveloperTokenWellFormed: jest.fn().mockReturnValue(true),
      getOAuthConfigDiagnostics: jest.fn(),
      handleAppleMusicCallback: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: getRepositoryToken(User),
          useValue: { findOne: jest.fn() },
        },
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
        {
          provide: JwtService,
          useValue: { verify: jest.fn() },
        },
        {
          provide: TokenBlacklistService,
          useValue: { isBlacklisted: jest.fn().mockResolvedValue(false), add: jest.fn() },
        },
        {
          // Required so the AdminEmailGuard on GET /auth/oauth/diagnostics can be
          // instantiated by the testing module (its canActivate isn't exercised here).
          provide: ConfigService,
          useValue: { get: jest.fn() },
        },
      ],
    }).compile();

    authController = module.get<AuthController>(AuthController);
    authService = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("POST /auth/signup", () => {
    it("should call service.signup with body", async () => {
      const signupBody = {
        fullName: "John Doe",
        email: "john@example.com",
        password: "password123",
        country: "US",
      };

      (authService.signup as jest.Mock).mockResolvedValue(mockAuthResponse);

      const result = await authController.signup(signupBody);

      expect(authService.signup).toHaveBeenCalledWith(signupBody);
      expect(authService.signup).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockAuthResponse);
    });

    it("should pass through service response", async () => {
      const signupBody = {
        fullName: "Jane Doe",
        email: "jane@example.com",
        password: "securepass",
        country: "UK",
      };

      const serviceResponse = {
        token: "different.token.here",
        user: {
          id: "user_2",
          fullName: "Jane Doe",
          email: "jane@example.com",
          country: "UK",
          connectedPlatforms: [],
        },
      };

      (authService.signup as jest.Mock).mockResolvedValue(serviceResponse);

      const result = await authController.signup(signupBody);

      expect(result).toEqual(serviceResponse);
    });

    it("should handle errors from service", async () => {
      const signupBody = {
        fullName: "John Doe",
        email: "john@example.com",
        password: "password123",
        country: "US",
      };

      const error = new Error("User already exists");
      (authService.signup as jest.Mock).mockRejectedValue(error);

      await expect(authController.signup(signupBody)).rejects.toThrow(
        "User already exists"
      );
    });
  });

  describe("POST /auth/login", () => {
    it("should call service.login with body", async () => {
      const loginBody = {
        email: "john@example.com",
        password: "password123",
      };

      (authService.login as jest.Mock).mockResolvedValue(mockAuthResponse);

      const result = await authController.login(loginBody);

      expect(authService.login).toHaveBeenCalledWith(loginBody);
      expect(authService.login).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockAuthResponse);
    });

    it("should pass through service response", async () => {
      const loginBody = {
        email: "user@example.com",
        password: "pass123",
      };

      const serviceResponse = {
        token: "login.token.here",
        user: {
          id: "user_3",
          fullName: "User Name",
          email: "user@example.com",
          country: "CA",
          connectedPlatforms: ["spotify"],
        },
      };

      (authService.login as jest.Mock).mockResolvedValue(serviceResponse);

      const result = await authController.login(loginBody);

      expect(result).toEqual(serviceResponse);
    });

    it("should handle authentication errors", async () => {
      const loginBody = {
        email: "john@example.com",
        password: "wrongpassword",
      };

      const error = new Error("Invalid email or password");
      (authService.login as jest.Mock).mockRejectedValue(error);

      await expect(authController.login(loginBody)).rejects.toThrow(
        "Invalid email or password"
      );
    });
  });

  describe("POST /auth/forgot-password", () => {
    it("should call service.forgotPassword with email from body", async () => {
      const forgotPasswordBody = {
        email: "john@example.com",
      };

      const response = {
        message: "If that email exists, a verification code has been sent",
      };

      (authService.forgotPassword as jest.Mock).mockResolvedValue(response);

      const result = await authController.forgotPassword(forgotPasswordBody);

      expect(authService.forgotPassword).toHaveBeenCalledWith(
        forgotPasswordBody.email
      );
      expect(authService.forgotPassword).toHaveBeenCalledTimes(1);
      expect(result).toEqual(response);
    });

    it("should pass through service response", async () => {
      const forgotPasswordBody = {
        email: "user@example.com",
      };

      const response = {
        message: "If that email exists, a verification code has been sent",
      };

      (authService.forgotPassword as jest.Mock).mockResolvedValue(response);

      const result = await authController.forgotPassword(forgotPasswordBody);

      expect(result).toEqual(response);
    });

    it("should handle service errors", async () => {
      const forgotPasswordBody = {
        email: "john@example.com",
      };

      const error = new Error("Database error");
      (authService.forgotPassword as jest.Mock).mockRejectedValue(error);

      await expect(
        authController.forgotPassword(forgotPasswordBody)
      ).rejects.toThrow("Database error");
    });
  });

  describe("POST /auth/verify-code", () => {
    it("should call service.verifyCode with email and code", async () => {
      const verifyCodeBody = {
        email: "john@example.com",
        code: "123456",
      };

      const response = { verified: true };

      (authService.verifyCode as jest.Mock).mockResolvedValue(response);

      const result = await authController.verifyCode(verifyCodeBody);

      expect(authService.verifyCode).toHaveBeenCalledWith(
        verifyCodeBody.email,
        verifyCodeBody.code
      );
      expect(authService.verifyCode).toHaveBeenCalledTimes(1);
      expect(result).toEqual(response);
    });

    it("should pass through service response", async () => {
      const verifyCodeBody = {
        email: "user@example.com",
        code: "654321",
      };

      const response = { verified: true };

      (authService.verifyCode as jest.Mock).mockResolvedValue(response);

      const result = await authController.verifyCode(verifyCodeBody);

      expect(result).toEqual(response);
    });

    it("should handle verification errors", async () => {
      const verifyCodeBody = {
        email: "john@example.com",
        code: "invalid",
      };

      const error = new Error("Invalid or expired code");
      (authService.verifyCode as jest.Mock).mockRejectedValue(error);

      await expect(authController.verifyCode(verifyCodeBody)).rejects.toThrow(
        "Invalid or expired code"
      );
    });
  });

  describe("POST /auth/reset-password", () => {
    it("should call service.resetPassword with email, resetToken, and newPassword", async () => {
      const resetPasswordBody = {
        email: "john@example.com",
        resetToken: "abc123token",
        newPassword: "newpassword123",
      };

      const response = { message: "Password has been reset successfully" };

      (authService.resetPassword as jest.Mock).mockResolvedValue(response);

      const result = await authController.resetPassword(resetPasswordBody);

      expect(authService.resetPassword).toHaveBeenCalledWith(
        resetPasswordBody.email,
        resetPasswordBody.resetToken,
        resetPasswordBody.newPassword
      );
      expect(authService.resetPassword).toHaveBeenCalledTimes(1);
      expect(result).toEqual(response);
    });

    it("should pass through service response", async () => {
      const resetPasswordBody = {
        email: "user@example.com",
        resetToken: "abc123token",
        newPassword: "newpass456",
      };

      const response = { message: "Password has been reset successfully" };

      (authService.resetPassword as jest.Mock).mockResolvedValue(response);

      const result = await authController.resetPassword(resetPasswordBody);

      expect(result).toEqual(response);
    });

    it("should handle reset errors", async () => {
      const resetPasswordBody = {
        email: "john@example.com",
        resetToken: "abc123token",
        newPassword: "newpassword123",
      };

      const error = new Error("Could not reset password");
      (authService.resetPassword as jest.Mock).mockRejectedValue(error);

      await expect(
        authController.resetPassword(resetPasswordBody)
      ).rejects.toThrow("Could not reset password");
    });
  });

  describe("POST /auth/logout", () => {
    const mockUser = {
      sub: "user_1",
      email: "john@example.com",
      token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    };

    it("should call service.logout with token from the authenticated request", async () => {
      const response = { message: "Logged out successfully" };

      (authService.logout as jest.Mock).mockResolvedValue(response);

      const result = await authController.logout(mockUser, {});

      expect(authService.logout).toHaveBeenCalledWith(mockUser.token, undefined);
      expect(authService.logout).toHaveBeenCalledTimes(1);
      expect(result).toEqual(response);
    });

    it("should pass through service response", async () => {
      const response = { message: "Logged out successfully" };

      (authService.logout as jest.Mock).mockResolvedValue(response);

      const result = await authController.logout(mockUser, {});

      expect(result).toEqual(response);
    });

    it("should handle logout errors", async () => {
      const error = new Error("Logout failed");
      (authService.logout as jest.Mock).mockRejectedValue(error);

      await expect(authController.logout(mockUser, {})).rejects.toThrow(
        "Logout failed"
      );
    });
  });

  describe("POST /auth/refresh", () => {
    it("rotates the body refresh token without requiring an access token", async () => {
      const response = { token: "next-access", refreshToken: "next-refresh" };
      (authService.refresh as jest.Mock).mockResolvedValue(response);

      await expect(authController.refresh({ refreshToken: "refresh-token-with-sufficient-length" }))
        .resolves.toEqual(response);
      expect(authService.refresh).toHaveBeenCalledWith("refresh-token-with-sufficient-length");
    });
  });

  describe("POST /auth/upgrade-session", () => {
    it("upgrades a legacy access-only session", async () => {
      const user = {
        sub: "user_1",
        email: "john@example.com",
        token: "legacy-access-token",
      };
      const response = { token: "next-access", refreshToken: "next-refresh" };
      (authService.upgradeSession as jest.Mock).mockResolvedValue(response);

      await expect(authController.upgradeSession(user)).resolves.toEqual(response);
      expect(authService.upgradeSession).toHaveBeenCalledWith(user.token, user.sub);
    });
  });

  describe("GET /auth/spotify/callback", () => {
    it("should redirect back into the app on success", async () => {
      (authService.handleSpotifyCallback as jest.Mock).mockResolvedValue({
        success: true,
        message: "Spotify account connected successfully",
      });

      const result = await authController.spotifyCallback("code", "state", undefined);

      expect(authService.handleSpotifyCallback).toHaveBeenCalledWith("code", "state");
      expect(result).toEqual({ url: "repitair://spotify-connected?status=success" });
    });

    it("should redirect back into the app when the user cancels Spotify auth", async () => {
      const result = await authController.spotifyCallback(undefined, undefined, "access_denied");

      expect(authService.handleSpotifyCallback).not.toHaveBeenCalled();
      expect(result).toEqual({
        url: "repitair://spotify-connected?status=error&message=Spotify+connection+was+cancelled.",
      });
    });

    it("should redirect back into the app when Spotify callback handling fails", async () => {
      (authService.handleSpotifyCallback as jest.Mock).mockRejectedValue(
        new Error("Failed to exchange authorization code for tokens"),
      );

      const result = await authController.spotifyCallback("code", "state", undefined);

      expect(result).toEqual({
        url: "repitair://spotify-connected?status=error&message=Could+not+connect+Spotify.+Please+try+again.",
      });
    });
  });

  describe("GET /auth/apple-music/authorize", () => {
    it("posts the Music User Token to a callback that preserves the mounted API prefix", async () => {
      (authService.validateAppleMusicAuthorizationState as jest.Mock).mockResolvedValue(undefined);
      (authService.generateMusicKitDeveloperToken as jest.Mock).mockReturnValue("developer-token");
      const send = jest.fn();
      const response = {
        redirect: jest.fn(),
        type: jest.fn().mockReturnThis(),
        send,
      };

      await authController.appleMusicAuthorize("oauth-state", response as never);

      expect(response.type).toHaveBeenCalledWith("text/html");
      expect(send).toHaveBeenCalledTimes(1);
      const html = send.mock.calls[0][0] as string;
      expect(html).toContain(
        "const CALLBACK_URL = new URL('callback', window.location.href).toString();",
      );
      expect(html).not.toContain("window.location.origin + '/auth/apple-music/callback'");
    });

    it("fails loudly with a config error instead of serving a broken MusicKit page when the developer token is malformed", async () => {
      (authService.validateAppleMusicAuthorizationState as jest.Mock).mockResolvedValue(undefined);
      (authService.generateMusicKitDeveloperToken as jest.Mock).mockReturnValue("malformed-token");
      (authService.isDeveloperTokenWellFormed as jest.Mock).mockReturnValue(false);
      const send = jest.fn();
      const response = {
        redirect: jest.fn(),
        type: jest.fn().mockReturnThis(),
        send,
      };

      await authController.appleMusicAuthorize("oauth-state", response as never);

      // No MusicKit page served; a deep-link error redirect is issued instead.
      expect(send).not.toHaveBeenCalled();
      expect(response.redirect).toHaveBeenCalledTimes(1);
      expect(String(response.redirect.mock.calls[0][0])).toContain("repitair://apple-music-connected");
      expect(String(response.redirect.mock.calls[0][0])).toContain("status=error");
    });
  });
});
