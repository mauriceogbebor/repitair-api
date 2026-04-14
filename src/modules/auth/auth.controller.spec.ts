import { Test, TestingModule } from "@nestjs/testing";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";

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
      forgotPassword: jest.fn(),
      verifyCode: jest.fn(),
      resetPassword: jest.fn(),
      logout: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: mockAuthService,
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
    it("should call service.resetPassword with email and newPassword", async () => {
      const resetPasswordBody = {
        email: "john@example.com",
        newPassword: "newpassword123",
      };

      const response = { message: "Password has been reset successfully" };

      (authService.resetPassword as jest.Mock).mockResolvedValue(response);

      const result = await authController.resetPassword(resetPasswordBody);

      expect(authService.resetPassword).toHaveBeenCalledWith(
        resetPasswordBody.email,
        resetPasswordBody.newPassword
      );
      expect(authService.resetPassword).toHaveBeenCalledTimes(1);
      expect(result).toEqual(response);
    });

    it("should pass through service response", async () => {
      const resetPasswordBody = {
        email: "user@example.com",
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

      const result = await authController.logout(mockUser);

      expect(authService.logout).toHaveBeenCalledWith(mockUser.token);
      expect(authService.logout).toHaveBeenCalledTimes(1);
      expect(result).toEqual(response);
    });

    it("should pass through service response", async () => {
      const response = { message: "Logged out successfully" };

      (authService.logout as jest.Mock).mockResolvedValue(response);

      const result = await authController.logout(mockUser);

      expect(result).toEqual(response);
    });

    it("should handle logout errors", async () => {
      const error = new Error("Logout failed");
      (authService.logout as jest.Mock).mockRejectedValue(error);

      await expect(authController.logout(mockUser)).rejects.toThrow(
        "Logout failed"
      );
    });
  });
});
