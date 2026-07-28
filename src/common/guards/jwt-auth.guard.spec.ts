import { Test, TestingModule } from "@nestjs/testing";
import { UnauthorizedException, ExecutionContext } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { TokenBlacklistService } from "../services/token-blacklist.service";
import { getRepositoryToken } from "@nestjs/typeorm";
import { User } from "../../entities";

describe("JwtAuthGuard", () => {
  let jwtAuthGuard: JwtAuthGuard;
  let jwtService: JwtService;
  let tokenBlacklist: TokenBlacklistService;
  let userRepository: { findOne: jest.Mock };

  const mockJwtPayload = {
    sub: "user_1",
    email: "john@example.com",
  };

  const mockValidToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzEiLCJlbWFpbCI6ImpvaG5AZXhhbXBsZS5jb20ifQ.signature";

  beforeEach(async () => {
    const mockJwtServiceProvider = {
      provide: JwtService,
      useValue: {
        verify: jest.fn(),
      },
    };

    const mockTokenBlacklistProvider = {
      provide: TokenBlacklistService,
      useValue: {
        isBlacklisted: jest.fn().mockResolvedValue(false),
        add: jest.fn(),
      },
    };
    const mockUserRepositoryProvider = {
      provide: getRepositoryToken(User),
      useValue: {
        findOne: jest.fn(({ where }: { where: { id: string } }) => Promise.resolve({
          id: where.id,
          email: where.id === "user_123" ? "custom@example.com" : "john@example.com",
          isSuspended: false,
          sessionVersion: 0,
        })),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [JwtAuthGuard, mockJwtServiceProvider, mockTokenBlacklistProvider, mockUserRepositoryProvider],
    }).compile();

    jwtAuthGuard = module.get<JwtAuthGuard>(JwtAuthGuard);
    jwtService = module.get<JwtService>(JwtService);
    tokenBlacklist = module.get<TokenBlacklistService>(TokenBlacklistService);
    userRepository = module.get(getRepositoryToken(User));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const createMockContext = (headers: Record<string, unknown> = {}): ExecutionContext => {
    const mockRequest = { headers, user: undefined };
    return {
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(mockRequest),
      }),
    } as unknown as ExecutionContext;
  };

  describe("canActivate", () => {
    it("should allow request with valid Bearer token", async () => {
      const mockContext = createMockContext({ authorization: `Bearer ${mockValidToken}` });
      (jwtService.verify as jest.Mock).mockReturnValue(mockJwtPayload);

      const result = await jwtAuthGuard.canActivate(mockContext);

      expect(jwtService.verify).toHaveBeenCalledWith(mockValidToken);
      expect(result).toBe(true);
      const request = mockContext.switchToHttp().getRequest();
      expect(request.user).toEqual({
        sub: mockJwtPayload.sub,
        email: mockJwtPayload.email,
        token: mockValidToken,
      });
    });

    it("should attach user payload to request object", async () => {
      const mockContext = createMockContext({ authorization: `Bearer ${mockValidToken}` });
      const customPayload = { sub: "user_123", email: "custom@example.com" };
      (jwtService.verify as jest.Mock).mockReturnValue(customPayload);

      await jwtAuthGuard.canActivate(mockContext);

      const request = mockContext.switchToHttp().getRequest();
      expect(request.user).toEqual({ ...customPayload, token: mockValidToken });
    });

    it("should throw UnauthorizedException when no auth header", async () => {
      const mockContext = createMockContext({});

      await expect(jwtAuthGuard.canActivate(mockContext)).rejects.toThrow(
        new UnauthorizedException({ errorCode: "SESSION_INVALID", message: "Missing or invalid Authorization header", retriable: false })
      );
      expect(jwtService.verify).not.toHaveBeenCalled();
    });

    it("should throw UnauthorizedException when auth header is null", async () => {
      const mockContext = createMockContext({ authorization: null });

      await expect(jwtAuthGuard.canActivate(mockContext)).rejects.toThrow(
        new UnauthorizedException({ errorCode: "SESSION_INVALID", message: "Missing or invalid Authorization header", retriable: false })
      );
    });

    it("should throw UnauthorizedException when auth header is undefined", async () => {
      const mockContext = createMockContext({ authorization: undefined });

      await expect(jwtAuthGuard.canActivate(mockContext)).rejects.toThrow(
        new UnauthorizedException({ errorCode: "SESSION_INVALID", message: "Missing or invalid Authorization header", retriable: false })
      );
    });

    it("should throw UnauthorizedException when malformed header - no Bearer prefix", async () => {
      const mockContext = createMockContext({ authorization: mockValidToken });

      await expect(jwtAuthGuard.canActivate(mockContext)).rejects.toThrow(
        new UnauthorizedException({ errorCode: "SESSION_INVALID", message: "Missing or invalid Authorization header", retriable: false })
      );
      expect(jwtService.verify).not.toHaveBeenCalled();
    });

    it("should throw UnauthorizedException when header has wrong prefix", async () => {
      const mockContext = createMockContext({ authorization: `Basic ${mockValidToken}` });

      await expect(jwtAuthGuard.canActivate(mockContext)).rejects.toThrow(
        new UnauthorizedException({ errorCode: "SESSION_INVALID", message: "Missing or invalid Authorization header", retriable: false })
      );
    });

    it("should throw UnauthorizedException when token is expired", async () => {
      const mockContext = createMockContext({ authorization: `Bearer ${mockValidToken}` });
      (jwtService.verify as jest.Mock).mockImplementation(() => {
        const error = new Error("jwt expired");
        error.name = "TokenExpiredError";
        throw error;
      });

      await expect(jwtAuthGuard.canActivate(mockContext)).rejects.toThrow(
        new UnauthorizedException({ errorCode: "ACCESS_TOKEN_EXPIRED", message: "Access token expired", retriable: true })
      );
    });

    it("should throw UnauthorizedException when token is invalid", async () => {
      const mockContext = createMockContext({ authorization: `Bearer invalid.token.here` });
      (jwtService.verify as jest.Mock).mockImplementation(() => { throw new Error("invalid signature"); });

      await expect(jwtAuthGuard.canActivate(mockContext)).rejects.toThrow(
        new UnauthorizedException({ errorCode: "SESSION_INVALID", message: "Invalid access token", retriable: false })
      );
    });

    it("should throw UnauthorizedException when jwt malformed", async () => {
      const mockContext = createMockContext({ authorization: `Bearer malformed` });
      (jwtService.verify as jest.Mock).mockImplementation(() => { throw new Error("jwt malformed"); });

      await expect(jwtAuthGuard.canActivate(mockContext)).rejects.toThrow(
        new UnauthorizedException({ errorCode: "SESSION_INVALID", message: "Invalid access token", retriable: false })
      );
    });

    it("should extract token correctly from Bearer header", async () => {
      const testToken = "test.token.value";
      const mockContext = createMockContext({ authorization: `Bearer ${testToken}` });
      (jwtService.verify as jest.Mock).mockReturnValue(mockJwtPayload);

      await jwtAuthGuard.canActivate(mockContext);

      expect(jwtService.verify).toHaveBeenCalledWith(testToken);
    });

    it("should reject a blacklisted token", async () => {
      const mockContext = createMockContext({ authorization: `Bearer ${mockValidToken}` });
      // verify succeeds (token is valid) but its jti is blacklisted
      (jwtService.verify as jest.Mock).mockReturnValue({ ...mockJwtPayload, jti: "revoked-jti" });
      (tokenBlacklist.isBlacklisted as jest.Mock).mockResolvedValueOnce(true);

      await expect(jwtAuthGuard.canActivate(mockContext)).rejects.toThrow(
        new UnauthorizedException({ errorCode: "SESSION_INVALID", message: "Token has been revoked", retriable: false })
      );
      expect(tokenBlacklist.isBlacklisted).toHaveBeenCalledWith("revoked-jti");
    });

    it("should reject a token issued before a consumer session revocation", async () => {
      const mockContext = createMockContext({ authorization: `Bearer ${mockValidToken}` });
      (jwtService.verify as jest.Mock).mockReturnValue({ ...mockJwtPayload, sessionVersion: 0 });
      userRepository.findOne.mockResolvedValueOnce({
        id: mockJwtPayload.sub,
        email: mockJwtPayload.email,
        isSuspended: false,
        sessionVersion: 1,
      });

      await expect(jwtAuthGuard.canActivate(mockContext)).rejects.toThrow(
        new UnauthorizedException({ errorCode: "SESSION_INVALID", message: "This session has been revoked", retriable: false }),
      );
    });
  });
});
