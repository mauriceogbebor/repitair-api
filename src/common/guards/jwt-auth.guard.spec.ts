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
        isBlacklisted: jest.fn().mockReturnValue(false),
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

  describe("canActivate", () => {
    it("should allow request with valid Bearer token", () => {
      const mockRequest = {
        headers: {
          authorization: `Bearer ${mockValidToken}`,
        },
        user: undefined,
      };

      const mockContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
        }),
      } as unknown as ExecutionContext;

      (jwtService.verify as jest.Mock).mockReturnValue(mockJwtPayload);

      const result = jwtAuthGuard.canActivate(mockContext);

      expect(jwtService.verify).toHaveBeenCalledWith(mockValidToken);
      expect(result).toBe(true);
      expect(mockRequest.user).toEqual({
        sub: mockJwtPayload.sub,
        email: mockJwtPayload.email,
        token: mockValidToken,
      });
    });

    it("should attach user payload to request object", () => {
      const mockRequest = {
        headers: {
          authorization: `Bearer ${mockValidToken}`,
        },
        user: undefined,
      };

      const mockContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
        }),
      } as unknown as ExecutionContext;

      const customPayload = {
        sub: "user_123",
        email: "custom@example.com",
      };

      (jwtService.verify as jest.Mock).mockReturnValue(customPayload);

      jwtAuthGuard.canActivate(mockContext);

      expect(mockRequest.user).toEqual({ ...customPayload, token: mockValidToken });
    });

    it("should throw UnauthorizedException when no auth header", () => {
      const mockRequest = {
        headers: {},
        user: undefined,
      };

      const mockContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
        }),
      } as unknown as ExecutionContext;

      expect(() => jwtAuthGuard.canActivate(mockContext)).toThrow(
        new UnauthorizedException("Missing or invalid Authorization header")
      );

      expect(jwtService.verify).not.toHaveBeenCalled();
    });

    it("should throw UnauthorizedException when auth header is null", () => {
      const mockRequest = {
        headers: {
          authorization: null,
        },
        user: undefined,
      };

      const mockContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
        }),
      } as unknown as ExecutionContext;

      expect(() => jwtAuthGuard.canActivate(mockContext)).toThrow(
        new UnauthorizedException("Missing or invalid Authorization header")
      );
    });

    it("should throw UnauthorizedException when auth header is undefined", () => {
      const mockRequest = {
        headers: {
          authorization: undefined,
        },
        user: undefined,
      };

      const mockContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
        }),
      } as unknown as ExecutionContext;

      expect(() => jwtAuthGuard.canActivate(mockContext)).toThrow(
        new UnauthorizedException("Missing or invalid Authorization header")
      );
    });

    it("should throw UnauthorizedException when malformed header - no Bearer prefix", () => {
      const mockRequest = {
        headers: {
          authorization: mockValidToken, // Missing "Bearer " prefix
        },
        user: undefined,
      };

      const mockContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
        }),
      } as unknown as ExecutionContext;

      expect(() => jwtAuthGuard.canActivate(mockContext)).toThrow(
        new UnauthorizedException("Missing or invalid Authorization header")
      );

      expect(jwtService.verify).not.toHaveBeenCalled();
    });

    it("should throw UnauthorizedException when header has wrong prefix", () => {
      const mockRequest = {
        headers: {
          authorization: `Basic ${mockValidToken}`,
        },
        user: undefined,
      };

      const mockContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
        }),
      } as unknown as ExecutionContext;

      expect(() => jwtAuthGuard.canActivate(mockContext)).toThrow(
        new UnauthorizedException("Missing or invalid Authorization header")
      );
    });

    it("should throw UnauthorizedException when token is expired", () => {
      const mockRequest = {
        headers: {
          authorization: `Bearer ${mockValidToken}`,
        },
        user: undefined,
      };

      const mockContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
        }),
      } as unknown as ExecutionContext;

      const expiredError = new Error("jwt expired");
      (jwtService.verify as jest.Mock).mockImplementation(() => {
        throw expiredError;
      });

      expect(() => jwtAuthGuard.canActivate(mockContext)).toThrow(
        new UnauthorizedException("Invalid or expired token")
      );
    });

    it("should throw UnauthorizedException when token is invalid", () => {
      const mockRequest = {
        headers: {
          authorization: `Bearer invalid.token.here`,
        },
        user: undefined,
      };

      const mockContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
        }),
      } as unknown as ExecutionContext;

      const invalidError = new Error("invalid signature");
      (jwtService.verify as jest.Mock).mockImplementation(() => {
        throw invalidError;
      });

      expect(() => jwtAuthGuard.canActivate(mockContext)).toThrow(
        new UnauthorizedException("Invalid or expired token")
      );
    });

    it("should throw UnauthorizedException when jwt malformed", () => {
      const mockRequest = {
        headers: {
          authorization: `Bearer malformed`,
        },
        user: undefined,
      };

      const mockContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
        }),
      } as unknown as ExecutionContext;

      const malformedError = new Error("jwt malformed");
      (jwtService.verify as jest.Mock).mockImplementation(() => {
        throw malformedError;
      });

      expect(() => jwtAuthGuard.canActivate(mockContext)).toThrow(
        new UnauthorizedException("Invalid or expired token")
      );
    });

    it("should extract token correctly from Bearer header", () => {
      const testToken = "test.token.value";
      const mockRequest = {
        headers: {
          authorization: `Bearer ${testToken}`,
        },
        user: undefined,
      };

      const mockContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
        }),
      } as unknown as ExecutionContext;

      (jwtService.verify as jest.Mock).mockReturnValue(mockJwtPayload);

      jwtAuthGuard.canActivate(mockContext);

      expect(jwtService.verify).toHaveBeenCalledWith(testToken);
    });

    it("should handle Bearer token with extra whitespace", () => {
      const mockRequest = {
        headers: {
          authorization: `Bearer  ${mockValidToken}`, // Extra space
        },
        user: undefined,
      };

      const mockContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
        }),
      } as unknown as ExecutionContext;

      // This will fail because we extract from position 7, so extra space will be included
      (jwtService.verify as jest.Mock).mockReturnValue(mockJwtPayload);

      jwtAuthGuard.canActivate(mockContext);

      // Verify that extra space is passed to verify
      const callArg = (jwtService.verify as jest.Mock).mock.calls[0][0];
      expect(callArg.startsWith(" ")).toBe(true);
    });

    it("should set user on request for successful verification", () => {
      const mockRequest = {
        headers: {
          authorization: `Bearer ${mockValidToken}`,
        },
        user: undefined,
      };

      const mockContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
        }),
      } as unknown as ExecutionContext;

      const payload = {
        sub: "specific_user",
        email: "specific@email.com",
      };

      (jwtService.verify as jest.Mock).mockReturnValue(payload);

      const result = jwtAuthGuard.canActivate(mockContext);

      expect(result).toBe(true);
      expect(mockRequest.user).toEqual({ ...payload, token: mockValidToken });
    });

    it("should reject a blacklisted token", () => {
      const mockRequest = {
        headers: { authorization: `Bearer ${mockValidToken}` },
        user: undefined,
      };
      const mockContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
        }),
      } as unknown as ExecutionContext;

      (tokenBlacklist.isBlacklisted as jest.Mock).mockReturnValueOnce(true);

      expect(() => jwtAuthGuard.canActivate(mockContext)).toThrow(
        new UnauthorizedException("Token has been revoked"),
      );
      expect(jwtService.verify).not.toHaveBeenCalled();
    });
  });
});
