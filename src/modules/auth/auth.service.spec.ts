import { Test, TestingModule } from "@nestjs/testing";
import { ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { AuthService } from "./auth.service";
import { AppleIdentityService } from "./apple-identity.service";
import { UsersService } from "../users/users.service";
import { MailService } from "../../common/services/mail.service";
import { TokenBlacklistService } from "../../common/services/token-blacklist.service";

describe("AuthService", () => {
  let authService: AuthService;
  let usersService: UsersService;
  let jwtService: JwtService;
  let tokenBlacklist: TokenBlacklistService;
  let appleIdentity: { verifyIdentityToken: jest.Mock };

  const mockUser = {
    id: "user_1",
    fullName: "John Doe",
    email: "john@example.com",
    country: "US",
    connectedPlatforms: [],
    password: "hashedPassword123",
    isSuspended: false,
  };

  const mockToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...";
  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    // Create mock UsersService
    const mockUsersService = {
      createUser: jest.fn(),
      findByEmail: jest.fn(),
      findById: jest.fn(),
      validatePassword: jest.fn(),
      recordLogin: jest.fn(),
      setResetCode: jest.fn(),
      verifyResetCode: jest.fn(),
      resetPassword: jest.fn(),
    };

    // Create mock JwtService
    const mockJwtService = {
      sign: jest.fn().mockReturnValue(mockToken),
      verify: jest.fn(),
      decode: jest.fn().mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 60 * 60 }),
    };

    const mockMailService = {
      sendPasswordResetCode: jest.fn().mockResolvedValue(undefined),
    };

    const mockTokenBlacklist = {
      add: jest.fn(),
      isBlacklisted: jest.fn().mockReturnValue(false),
    };

    const mockAppleIdentity = {
      verifyIdentityToken: jest.fn(),
    };

    mockConfigService.get.mockImplementation((key: string) => {
      if (key === "GOOGLE_CLIENT_ID") return "google-client-id";
      if (key === "APPLE_CLIENT_ID") return "apple-client-id";
      if (key === "JWT_REFRESH_SECRET") return "test-refresh-secret-that-is-long-enough";
      if (key === "JWT_REFRESH_EXPIRES_IN") return "30d";
      if (key === "NODE_ENV") return "test";
      return "mock-value";
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: MailService, useValue: mockMailService },
        { provide: TokenBlacklistService, useValue: mockTokenBlacklist },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: AppleIdentityService, useValue: mockAppleIdentity },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    usersService = module.get<UsersService>(UsersService);
    jwtService = module.get<JwtService>(JwtService);
    tokenBlacklist = module.get<TokenBlacklistService>(TokenBlacklistService);
    appleIdentity = module.get(AppleIdentityService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("signup", () => {
    it("should create user and return token + user object", async () => {
      const signupDto = {
        fullName: "John Doe",
        email: "john@example.com",
        password: "password123",
        country: "US",
      };

      (usersService.createUser as jest.Mock).mockResolvedValue(mockUser);
      (jwtService.sign as jest.Mock).mockReturnValue(mockToken);

      const result = await authService.signup(signupDto);

      expect(usersService.createUser).toHaveBeenCalledWith({
        fullName: signupDto.fullName,
        email: signupDto.email,
        password: signupDto.password,
        country: signupDto.country,
        signupSource: "email",
      });
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ sub: mockUser.id, email: mockUser.email }),
      );
      expect(result).toEqual(expect.objectContaining({
        token: mockToken,
        refreshToken: expect.any(String),
        expiresAt: expect.any(Number),
        refreshTokenExpiresAt: expect.any(Number),
        user: {
          id: mockUser.id,
          fullName: mockUser.fullName,
          email: mockUser.email,
          country: mockUser.country,
          connectedPlatforms: mockUser.connectedPlatforms,
          avatarUrl: null,
        },
      }));
    });

    it("should set country to empty string when not provided", async () => {
      const signupDto = {
        fullName: "Jane Doe",
        email: "jane@example.com",
        password: "password123",
      };

      (usersService.createUser as jest.Mock).mockResolvedValue({
        ...mockUser,
        email: signupDto.email,
        country: "",
      });

      await authService.signup(signupDto);

      expect(usersService.createUser).toHaveBeenCalledWith({
        fullName: signupDto.fullName,
        email: signupDto.email,
        password: signupDto.password,
        country: "",
        signupSource: "email",
      });
    });

    it("should propagate error if user already exists", async () => {
      const signupDto = {
        fullName: "John Doe",
        email: "john@example.com",
        password: "password123",
        country: "US",
      };

      const error = new Error("User already exists");
      (usersService.createUser as jest.Mock).mockRejectedValue(error);

      await expect(authService.signup(signupDto)).rejects.toThrow(
        "User already exists"
      );
    });
  });

  describe("login", () => {
    it("should return token for valid credentials", async () => {
      const loginDto = {
        email: "john@example.com",
        password: "password123",
      };

      (usersService.findByEmail as jest.Mock).mockResolvedValue(mockUser);
      (usersService.validatePassword as jest.Mock).mockResolvedValue(true);
      (jwtService.sign as jest.Mock).mockReturnValue(mockToken);

      const result = await authService.login(loginDto);

      expect(usersService.findByEmail).toHaveBeenCalledWith(loginDto.email);
      expect(usersService.validatePassword).toHaveBeenCalledWith(
        mockUser,
        loginDto.password
      );
      expect(usersService.recordLogin).toHaveBeenCalledWith(mockUser.id);
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ sub: mockUser.id, email: mockUser.email }),
      );
      expect(result).toEqual(expect.objectContaining({
        token: mockToken,
        refreshToken: expect.any(String),
        expiresAt: expect.any(Number),
        refreshTokenExpiresAt: expect.any(Number),
        user: {
          id: mockUser.id,
          fullName: mockUser.fullName,
          email: mockUser.email,
          country: mockUser.country,
          connectedPlatforms: mockUser.connectedPlatforms,
          avatarUrl: null,
        },
      }));
    });

    it("should throw UnauthorizedException for invalid email", async () => {
      const loginDto = {
        email: "nonexistent@example.com",
        password: "password123",
      };

      (usersService.findByEmail as jest.Mock).mockResolvedValue(null);

      await expect(authService.login(loginDto)).rejects.toThrow(
        new UnauthorizedException("Invalid email or password")
      );

      expect(usersService.validatePassword).not.toHaveBeenCalled();
    });

    it("should throw UnauthorizedException for invalid password", async () => {
      const loginDto = {
        email: "john@example.com",
        password: "wrongpassword",
      };

      (usersService.findByEmail as jest.Mock).mockResolvedValue(mockUser);
      (usersService.validatePassword as jest.Mock).mockResolvedValue(false);

      await expect(authService.login(loginDto)).rejects.toThrow(
        new UnauthorizedException("Invalid email or password")
      );

      expect(usersService.validatePassword).toHaveBeenCalledWith(
        mockUser,
        loginDto.password
      );
    });
  });

  describe("forgotPassword", () => {
    it("should return success message", async () => {
      const email = "john@example.com";

      (usersService.setResetCode as jest.Mock).mockResolvedValue(undefined);

      const result = await authService.forgotPassword(email);

      expect(usersService.setResetCode).toHaveBeenCalledWith(email);
      expect(result).toEqual({
        message: "If that email exists, a verification code has been sent",
      });
    });

    it("should handle errors from setResetCode", async () => {
      const email = "john@example.com";
      const error = new Error("Database error");

      (usersService.setResetCode as jest.Mock).mockRejectedValue(error);

      await expect(authService.forgotPassword(email)).rejects.toThrow(
        "Database error"
      );
    });
  });

  describe("verifyCode", () => {
    it("should return verified:true and resetToken for valid code", async () => {
      const email = "john@example.com";
      const code = "123456";
      const resetToken = "abc123resettoken";

      (usersService.verifyResetCode as jest.Mock).mockResolvedValue(resetToken);

      const result = await authService.verifyCode(email, code);

      expect(usersService.verifyResetCode).toHaveBeenCalledWith(email, code);
      expect(result).toEqual({ verified: true, resetToken });
    });

    it("should throw UnauthorizedException for invalid code", async () => {
      const email = "john@example.com";
      const code = "invalid";

      (usersService.verifyResetCode as jest.Mock).mockResolvedValue(null);

      await expect(authService.verifyCode(email, code)).rejects.toThrow(
        new UnauthorizedException("Invalid or expired code")
      );
    });

    it("should throw UnauthorizedException for expired code", async () => {
      const email = "john@example.com";
      const code = "123456";

      (usersService.verifyResetCode as jest.Mock).mockResolvedValue(null);

      await expect(authService.verifyCode(email, code)).rejects.toThrow(
        new UnauthorizedException("Invalid or expired code")
      );
    });
  });

  describe("resetPassword", () => {
    it("should return success message", async () => {
      const email = "john@example.com";
      const resetToken = "valid-reset-token";
      const newPassword = "newpassword123";

      (usersService.resetPassword as jest.Mock).mockResolvedValue(true);

      const result = await authService.resetPassword(email, resetToken, newPassword);

      expect(usersService.resetPassword).toHaveBeenCalledWith(
        email,
        resetToken,
        newPassword
      );
      expect(result).toEqual({
        message: "Password has been reset successfully",
      });
    });

    it("should throw UnauthorizedException if reset fails", async () => {
      const email = "john@example.com";
      const resetToken = "invalid-token";
      const newPassword = "newpassword123";

      (usersService.resetPassword as jest.Mock).mockResolvedValue(false);

      await expect(
        authService.resetPassword(email, resetToken, newPassword)
      ).rejects.toThrow(
        new UnauthorizedException("Could not reset password")
      );
    });

    it("should throw UnauthorizedException if user not found", async () => {
      const email = "nonexistent@example.com";
      const resetToken = "some-token";
      const newPassword = "newpassword123";

      (usersService.resetPassword as jest.Mock).mockResolvedValue(false);

      await expect(
        authService.resetPassword(email, resetToken, newPassword)
      ).rejects.toThrow(
        new UnauthorizedException("Could not reset password")
      );
    });
  });

  describe("logout", () => {
    it("should return success message", async () => {
      const token = "some.jwt.token";

      const result = await authService.logout(token);

      expect(result).toEqual({ message: "Logged out successfully" });
    });

    it("should handle any token value", async () => {
      const tokens = [
        "valid.jwt.token",
        "invalid",
        "",
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      ];

      for (const token of tokens) {
        const result = await authService.logout(token);
        expect(result).toEqual({ message: "Logged out successfully" });
      }
    });
  });

  describe("refresh sessions", () => {
    function mockVerifiedRefresh(overrides: Record<string, unknown> = {}) {
      (jwtService.verify as jest.Mock).mockReturnValue({
        sub: mockUser.id,
        email: mockUser.email,
        jti: "refresh-jti",
        type: "refresh",
        exp: Math.floor(Date.now() / 1000) + 3600,
        ...overrides,
      });
      return "refresh-token";
    }

    it("rotates a valid refresh token and revokes the old token ID", async () => {
      (usersService.findById as jest.Mock).mockResolvedValue(mockUser);
      const token = mockVerifiedRefresh();

      const result = await authService.refresh(token);

      expect(tokenBlacklist.isBlacklisted).toHaveBeenCalledWith("refresh:refresh-jti");
      expect(tokenBlacklist.add).toHaveBeenCalledWith("refresh:refresh-jti", expect.any(Number));
      expect(result).toEqual(expect.objectContaining({
        token: mockToken,
        refreshToken: expect.any(String),
        expiresAt: expect.any(Number),
        refreshTokenExpiresAt: expect.any(Number),
      }));
      expect(result.refreshToken).not.toBe(token);
    });

    it("rejects an expired refresh token with an explicit reason", async () => {
      const expiredError = new Error("jwt expired");
      expiredError.name = "TokenExpiredError";
      (jwtService.verify as jest.Mock).mockImplementation(() => { throw expiredError; });

      await expect(authService.refresh("expired-refresh-token")).rejects.toMatchObject({
        response: expect.objectContaining({ errorCode: "REFRESH_TOKEN_EXPIRED" }),
      });
    });

    it("rejects a revoked refresh token", async () => {
      (tokenBlacklist.isBlacklisted as jest.Mock).mockResolvedValueOnce(true);
      const token = mockVerifiedRefresh();

      await expect(authService.refresh(token)).rejects.toMatchObject({
        response: expect.objectContaining({ errorCode: "REFRESH_TOKEN_REVOKED" }),
      });
      expect(usersService.findById).not.toHaveBeenCalled();
    });

    it("rejects refresh for a suspended account", async () => {
      (usersService.findById as jest.Mock).mockResolvedValue({ ...mockUser, isSuspended: true });
      const token = mockVerifiedRefresh();

      await expect(authService.refresh(token)).rejects.toMatchObject({
        response: expect.objectContaining({ errorCode: "ACCOUNT_DISABLED" }),
      });
    });
  });

  describe("provider token verification", () => {
    it("should fail closed when GOOGLE_CLIENT_ID is missing", async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "GOOGLE_CLIENT_ID") return undefined;
        if (key === "GOOGLE_IOS_CLIENT_ID") return undefined;
        if (key === "GOOGLE_ANDROID_CLIENT_ID") return undefined;
        return "mock-value";
      });

      const fetchMock = jest.fn();
      const originalFetch = global.fetch;
      global.fetch = fetchMock as typeof fetch;

      try {
        await expect((authService as any).verifyGoogleIdToken("google-token")).rejects.toThrow(
          new ServiceUnavailableException(
            "Google Sign In is not available. Configure GOOGLE_CLIENT_ID or platform specific Google client IDs.",
          ),
        );
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        global.fetch = originalFetch;
      }
    });

    it("propagates ServiceUnavailableException from the Apple verifier (fail closed)", async () => {
      appleIdentity.verifyIdentityToken.mockRejectedValue(
        new ServiceUnavailableException(
          "Apple Sign In is not available. APPLE_CLIENT_ID must be configured.",
        ),
      );

      await expect(
        (authService as any).verifyAppleIdToken("apple-token"),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it("delegates Apple verification to AppleIdentityService — never the symmetric JwtService", async () => {
      appleIdentity.verifyIdentityToken.mockResolvedValue({
        email: "john@example.com",
        sub: "apple-sub-1",
      });

      const result = await (authService as any).verifyAppleIdToken(
        "apple-token",
        "nonce-123",
      );

      expect(appleIdentity.verifyIdentityToken).toHaveBeenCalledWith(
        "apple-token",
        { expectedNonce: "nonce-123" },
      );
      // The Apple identity token must NOT be routed through NestJS JwtService
      // (whose key is the symmetric JWT_SECRET) — that was the RS256 defect.
      expect(jwtService.verify).not.toHaveBeenCalled();
      expect(result).toEqual({ email: "john@example.com" });
    });

    it("socialAuth verifies Apple tokens via the Apple verifier and issues a session", async () => {
      appleIdentity.verifyIdentityToken.mockResolvedValue({
        email: "apple.user@example.com",
        sub: "apple-sub-42",
      });
      (usersService.findByEmail as jest.Mock).mockResolvedValue(mockUser);
      (jwtService.sign as jest.Mock).mockReturnValue(mockToken);

      const result = await authService.socialAuth({
        provider: "apple",
        idToken: "apple-identity-token",
        nonce: "nonce-xyz",
      });

      expect(appleIdentity.verifyIdentityToken).toHaveBeenCalledWith(
        "apple-identity-token",
        { expectedNonce: "nonce-xyz" },
      );
      expect(result).toEqual(
        expect.objectContaining({ token: mockToken, refreshToken: expect.any(String) }),
      );
    });
  });
});
