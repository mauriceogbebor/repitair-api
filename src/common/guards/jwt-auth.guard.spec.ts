import { Test, TestingModule } from "@nestjs/testing";
import { UnauthorizedException, ExecutionContext } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { TokenBlacklistService } from "../services/token-blacklist.service";

describe("JwtAuthGuard", () => {
  let jwtAuthGuard: JwtAuthGuard;
  let jwtService: JwtService;
  let tokenBlacklist: TokenBlacklistService;

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [JwtAuthGuard, mockJwtServiceProvider, mockTokenBlacklistProvider],
    }).compile();

    jwtAuthGuard = module.get<JwtAuthGuard>(JwtAuthGuard);
    jwtService = module.get<JwtService>(JwtService);
    tokenBlacklist = module.get<TokenBlacklistService>(TokenBlacklistService);
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
        new UnauthorizedException("Missing or invalid Authorization header")
      );
      expect(jwtService.verify).not.toHaveBeenCalled();
    });

    it("should throw UnauthorizedException when auth header is null", async () => {
      const mockContext = createMockContext({ authorization: null });

      await expect(jwtAuthGuard.canActivate(mockContext)).rejects.toThrow(
        new UnauthorizedException("Missing or invalid Authorization header")
      );
    });

    it("should throw UnauthorizedException when auth header is undefined", async () => {
      const mockContext = createMockContext({ authorization: undefined });

      await expect(jwtAuthGuard.canActivate(mockContext)).rejects.toThrow(
        new UnauthorizedException("Missing or invalid Authorization header")
      );
    });

    it("should throw UnauthorizedException when malformed header - no Bearer prefix", async () => {
      const mockContext = createMockContext({ authorization: mockValidToken });

      await expect(jwtAuthGuard.canActivate(mockContext)).rejects.toThrow(
        new UnauthorizedException("Missing or invalid Authorization header")
      );
      expect(jwtService.verify).not.toHaveBeenCalled();
    });

    it("should throw UnauthorizedException when header has wrong prefix", async () => {
      const mockContext = createMockContext({ authorization: `Basic ${mockValidToken}` });

      await expect(jwtAuthGuard.canActivate(mockContext)).rejects.toThrow(
        new UnauthorizedException("Missing or invalid Authorization header")
      );
    });

    it("should throw UnauthorizedException when token is expired", async () => {
      const mockContext = createMockContext({ authorization: `Bearer ${mockValidToken}` });
      (jwtService.verify as jest.Mock).mockImplementation(() => { throw new Error("jwt expired"); });

      await expect(jwtAuthGuard.canActivate(mockContext)).rejects.toThrow(
        new UnauthorizedException("Invalid or expired token")
      );
    });

    it("should throw UnauthorizedException when token is invalid", async () => {
      const mockContext = createMockContext({ authorization: `Bearer invalid.token.here` });
      (jwtService.verify as jest.Mock).mockImplementation(() => { throw new Error("invalid signature"); });

      await expect(jwtAuthGuard.canActivate(mockContext)).rejects.toThrow(
        new UnauthorizedException("Invalid or expired token")
      );
    });

    it("should throw UnauthorizedException when jwt malformed", async () => {
      const mockContext = createMockContext({ authorization: `Bearer malformed` });
      (jwtService.verify as jest.Mock).mockImplementation(() => { throw new Error("jwt malformed"); });

      await expect(jwtAuthGuard.canActivate(mockContext)).rejects.toThrow(
        new UnauthorizedException("Invalid or expired token")
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
        new UnauthorizedException("Token has been revoked")
      );
      expect(tokenBlacklist.isBlacklisted).toHaveBeenCalledWith("revoked-jti");
    });
  });
});
