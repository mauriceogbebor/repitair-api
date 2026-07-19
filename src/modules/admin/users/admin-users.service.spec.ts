import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AdminAuditLog, PushToken, Repit, User } from "../../../entities";
import { AdminAuditLogsService } from "../audit-logs/admin-audit-logs.service";
import { AdminUsersService } from "./admin-users.service";

describe("AdminUsersService", () => {
  let service: AdminUsersService;
  let userRepository: Repository<User>;

  const mockAuditLogsService = {
    append: jest.fn().mockResolvedValue(undefined),
  };

  const mockUserRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const mockRepitRepository = {
    count: jest.fn(),
    find: jest.fn(),
  };

  const mockPushTokenRepository = {
    find: jest.fn(),
  };

  const mockAdminAuditLogRepository = {
    find: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminUsersService,
        { provide: getRepositoryToken(User), useValue: mockUserRepository },
        { provide: getRepositoryToken(Repit), useValue: mockRepitRepository },
        { provide: getRepositoryToken(PushToken), useValue: mockPushTokenRepository },
        { provide: getRepositoryToken(AdminAuditLog), useValue: mockAdminAuditLogRepository },
        { provide: AdminAuditLogsService, useValue: mockAuditLogsService },
      ],
    }).compile();

    service = module.get(AdminUsersService);
    userRepository = module.get(getRepositoryToken(User));
  });

  it("suspends a user and writes an audit log", async () => {
    const user = {
      id: "user-1",
      fullName: "User One",
      email: "user@example.com",
      country: "NG",
      isSuspended: false,
      suspensionReason: null,
      suspendedAt: null,
      lastLoginAt: null,
      connectedPlatforms: [],
      pushTokens: [],
      createdAt: new Date(),
      emailVerified: false,
    } as unknown as User;

    mockUserRepository.findOne.mockResolvedValue(user);
    mockUserRepository.save.mockImplementation(async (value: User) => value);
    jest.spyOn(service, "getUserDetail").mockResolvedValue({ id: user.id, status: "suspended" } as never);

    const result = await service.suspendUser(user.id, { reason: "Chargeback investigation" }, { id: "a1", email: "admin@example.com" } as any, null);

    expect(userRepository.save).toHaveBeenCalled();
    expect(mockAuditLogsService.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin.users.suspended",
        targetType: "user",
        targetId: user.id,
      }),
    );
    expect(result).toEqual({ id: user.id, status: "suspended" });
  });

  it("exports all filtered rows, neutralizes formulas, and audits metadata", async () => {
    const qb: any = {
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        {
          id: "user-1",
          full_name: "=HYPERLINK(\"bad\")",
          email: "user@example.com",
          country: "NG",
          created_at: new Date("2026-01-01T00:00:00Z"),
          last_login_at: null,
          connected_platforms: ["spotify"],
          is_suspended: false,
          signup_source: "organic",
          repit_count: 4,
          push_token_count: 1,
          last_push_token_at: null,
        },
      ]),
    };
    mockUserRepository.createQueryBuilder.mockReturnValue(qb);

    const result = await service.exportUsers(
      { status: "active", search: "user" },
      { id: "admin-1", email: "admin@example.com" } as any,
      null,
    );

    expect(qb.andWhere).toHaveBeenCalledWith("user.isSuspended = false");
    expect(qb.limit).toHaveBeenCalledWith(10_001);
    expect(result.csv).toContain("'=HYPERLINK");
    expect(result.resultCount).toBe(1);
    expect(result.truncated).toBe(false);
    expect(mockAuditLogsService.append).toHaveBeenCalledWith(expect.objectContaining({
      action: "admin.users.exported",
      metadata: expect.objectContaining({ resultCount: 1, truncated: false, limit: 10_000 }),
    }));
  });
});
