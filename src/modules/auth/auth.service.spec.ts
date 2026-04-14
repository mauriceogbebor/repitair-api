import { Test, TestingModule } from "@nestjs/testing";
import { UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { AuthService } from "./auth.service";
import { UsersService } from "../users/users.service";
import { MailService } from "../../common/services/mail.service";
import { TokenBlacklistService } from "../../common/services/token-blacklist.service";

describe("AuthService", () => {
  let authService: AuthService;
  let usersService: UsersService;
  let jwtService: JwtService;

  const mockUser = {
    id: "user_1",
    fullName: "John Doe",
    email: "john@example.com",
    country: "US",
    connectedPlatforms: [],
    password: "hashedPassword123",
  };

  const mockToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...";

  beforeEach(async () => {
    // Create mock UsersService
    const mockUsersService = {
      createUser: jest.fn(),
      findByEmail: jest.fn(),
      validatePassword: jest.fn(),
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: MailService, useValue: mockMailService },
        { provide: TokenBlacklistService, useValue: mockTokenBlacklist },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    usersService = module.get<UsersService>(UsersService);
    jwtService = module.get<JwtService>(JwtService);
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
      });
      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: mockUser.id,
        email: mockUser.email,
      });
      expect(result).toEqual({
        token: mockToken,
        user: {
          id: mockUser.id,
          fullName: mockUser.fullName,
          email: mockUser.email,
          country: mockUser.country,
          connectedPlatforms: mockUser.connectedPlatforms,
        },
      });
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
      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: mockUser.id,
        email: mockUser.email,
      });
      expect(result).toEqual({
        token: mockToken,
        user: {
          id: mockUser.id,
          fullName: mockUser.fullName,
          email: mockUser.email,
          country: mockUser.country,
          connectedPlatforms: mockUser.connectedPlatforms,
        },
      });
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
    it("should return verified:true for valid code", async () => {
      const email = "john@example.com";
      const code = "123456";

      (usersService.verifyResetCode as jest.Mock).mockResolvedValue(true);

      const result = await authService.verifyCode(email, code);

      expect(usersService.verifyResetCode).toHaveBeenCalledWith(email, code);
      expect(result).toEqual({ verified: true });
    });

    it("should throw UnauthorizedException for invalid code", async () => {
      const email = "john@example.com";
      const code = "invalid";

      (usersService.verifyResetCode as jest.Mock).mockResolvedValue(false);

      await expect(authService.verifyCode(email, code)).rejects.toThrow(
        new UnauthorizedException("Invalid or expired code")
      );
    });

    it("should throw UnauthorizedException for expired code", async () => {
      const email = "john@example.com";
      const code = "123456";

      (usersService.verifyResetCode as jest.Mock).mockResolvedValue(false);

      await expect(authService.verifyCode(email, code)).rejects.toThrow(
        new UnauthorizedException("Invalid or expired code")
      );
    });
  });

  describe("resetPassword", () => {
    it("should return success message", async () => {
      const email = "john@example.com";
      const newPassword = "newpassword123";

      (usersService.resetPassword as jest.Mock).mockResolvedValue(true);

      const result = await authService.resetPassword(email, newPassword);

      expect(usersService.resetPassword).toHaveBeenCalledWith(
        email,
        newPassword
      );
      expect(result).toEqual({
        message: "Password has been reset successfully",
      });
    });

    it("should throw UnauthorizedException if reset fails", async () => {
      const email = "john@example.com";
      const newPassword = "newpassword123";

      (usersService.resetPassword as jest.Mock).mockResolvedValue(false);

      await expect(
        authService.resetPassword(email, newPassword)
      ).rejects.toThrow(
        new UnauthorizedException("Could not reset password")
      );
    });

    it("should throw UnauthorizedException if user not found", async () => {
      const email = "nonexistent@example.com";
      const newPassword = "newpassword123";

      (usersService.resetPassword as jest.Mock).mockResolvedValue(false);

      await expect(
        authService.resetPassword(email, newPassword)
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
});
