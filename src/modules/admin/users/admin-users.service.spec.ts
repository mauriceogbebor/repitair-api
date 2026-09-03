import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import {
  AdminAuditLog,
  ContactSubmission,
  PushToken,
  Repit,
  User,
  UserOperationalNote,
  UserRecoveryOperation,
  UserRestriction,
} from "../../../entities";
import { AuthService } from "../../auth/auth.service";
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
  const mockSupportTicketRepository = { find: jest.fn(), createQueryBuilder: jest.fn() };
  const mockUserNoteRepository = { find: jest.fn(), create: jest.fn((value) => value), save: jest.fn() };
  const mockRestrictionRepository = {
    find: jest.fn(),
    count: jest.fn(),
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => ({ id: "restriction-1", ...value })),
  };
  const mockRecoveryRepository = {
    find: jest.fn(),
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => ({ id: "recovery-1", createdAt: new Date(), ...value })),
  };
  const mockAuthService = { forgotPassword: jest.fn(), sendEmailVerification: jest.fn() };
  const mockEntityManager = {
    getRepository: jest.fn((entity) => {
      if (entity === User) return mockUserRepository;
      if (entity === UserOperationalNote) return mockUserNoteRepository;
      if (entity === UserRestriction) return mockRestrictionRepository;
      if (entity === UserRecoveryOperation) return mockRecoveryRepository;
      if (entity === AdminAuditLog) return mockAdminAuditLogRepository;
      throw new Error(`Unexpected transactional repository: ${entity?.name ?? entity}`);
    }),
  };
  const mockDataSource = {
    transaction: jest.fn(async (callback) => callback(mockEntityManager)),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAuthService.forgotPassword.mockResolvedValue(undefined);
    mockAuthService.sendEmailVerification.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminUsersService,
        { provide: getRepositoryToken(User), useValue: mockUserRepository },
        { provide: getRepositoryToken(Repit), useValue: mockRepitRepository },
        { provide: getRepositoryToken(PushToken), useValue: mockPushTokenRepository },
        { provide: getRepositoryToken(AdminAuditLog), useValue: mockAdminAuditLogRepository },
        { provide: getRepositoryToken(ContactSubmission), useValue: mockSupportTicketRepository },
        { provide: getRepositoryToken(UserOperationalNote), useValue: mockUserNoteRepository },
        { provide: getRepositoryToken(UserRestriction), useValue: mockRestrictionRepository },
        { provide: getRepositoryToken(UserRecoveryOperation), useValue: mockRecoveryRepository },
        { provide: AdminAuditLogsService, useValue: mockAuditLogsService },
        { provide: AuthService, useValue: mockAuthService },
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    service = module.get(AdminUsersService);
    userRepository = module.get(getRepositoryToken(User));
  });

  it("quotes reserved aliases in the operational directory query", async () => {
    const countQb: any = {
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0),
    };
    const listQb: any = {
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    mockUserRepository.createQueryBuilder
      .mockReturnValueOnce(countQb)
      .mockReturnValueOnce(listQb);

    await service.listUsers({ page: 1, pageSize: 12, sortBy: "createdAt", sortOrder: "desc" });

    const rawSelections = listQb.addSelect.mock.calls.map(([selection]: [string]) => selection).join("\n");
    expect(rawSelections).toContain('"user"."createdAt"');
    expect(rawSelections).toContain('"user"."id"::text');
    expect(rawSelections).toContain("user_restrictions");
    expect(listQb.addSelect).toHaveBeenCalledWith(
      expect.stringContaining("user_restrictions"),
      "active_restriction_count",
    );
    expect(rawSelections).not.toMatch(/\buser\."/);
    expect(rawSelections).not.toContain("= user.id");
  });

  it("uses explicit restriction records and an inclusive signup date range", async () => {
    const countQb: any = {
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0),
    };
    const listQb: any = {
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    mockUserRepository.createQueryBuilder
      .mockReturnValueOnce(countQb)
      .mockReturnValueOnce(listQb);

    await service.listUsers({
      restriction: "active",
      signupFrom: "2026-01-01",
      signupTo: "2026-01-31",
    });

    for (const qb of [countQb, listQb]) {
      expect(qb.andWhere).toHaveBeenCalledWith(expect.stringContaining("FROM user_restrictions"));
      expect(qb.andWhere).toHaveBeenCalledWith(
        "user.createdAt >= :signupFrom",
        { signupFrom: "2026-01-01T00:00:00.000Z" },
      );
      expect(qb.andWhere).toHaveBeenCalledWith(
        "user.createdAt < :signupToExclusive",
        { signupToExclusive: "2026-02-01T00:00:00.000Z" },
      );
    }
  });

  it("uses a PostgreSQL-safe support-case alias in user detail", async () => {
    const user = {
      id: "user-1",
      fullName: "User One",
      email: "user@example.com",
      country: "NG",
      avatarUrl: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      signupSource: "organic",
      isSuspended: false,
      suspensionReason: null,
      suspendedAt: null,
      emailVerified: true,
      connectedPlatforms: [],
      spotifyRefreshToken: null,
      appleMusicUserToken: null,
      pushTokens: [],
      lastLoginAt: null,
    } as unknown as User;
    const userQb: any = {
      addSelect: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(user),
    };
    const supportQb: any = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0),
    };
    mockUserRepository.createQueryBuilder.mockReturnValue(userQb);
    mockSupportTicketRepository.createQueryBuilder.mockReturnValue(supportQb);
    mockRepitRepository.count.mockResolvedValue(0);
    mockRestrictionRepository.count.mockResolvedValue(0);

    await service.getUserDetail(user.id, { permissionKeys: [] } as any, null);

    expect(mockSupportTicketRepository.createQueryBuilder).toHaveBeenCalledWith("support_case");
    expect(supportQb.where).toHaveBeenCalledWith(
      'support_case."relatedUserId" = :userId',
      { userId: user.id },
    );
    expect(supportQb.andWhere).toHaveBeenCalledWith(
      "support_case.status NOT IN (:...closedStatuses)",
      { closedStatuses: ["resolved", "closed"] },
    );
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
      sessionVersion: 0,
    } as unknown as User;

    mockUserRepository.findOne.mockResolvedValue(user);
    mockUserRepository.save.mockImplementation(async (value: User) => value);
    jest.spyOn(service, "getUserDetail").mockResolvedValue({ id: user.id, status: "suspended" } as never);

    const result = await service.suspendUser(user.id, { reason: "Chargeback investigation" }, { id: "a1", email: "admin@example.com" } as any, null);

    expect(userRepository.save).toHaveBeenCalled();
    expect(user.sessionVersion).toBe(1);
    expect(mockRestrictionRepository.save).toHaveBeenCalledWith(expect.objectContaining({
      userId: user.id,
      type: "account_suspension",
      status: "active",
    }));
    expect(mockAuditLogsService.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin.users.suspended",
        targetType: "user",
        targetId: user.id,
      }),
      mockEntityManager,
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
      { id: "admin-1", email: "admin@example.com", permissionKeys: ["users.read_pii"] } as any,
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

  it("revokes every consumer session by incrementing the session version and auditing the reason", async () => {
    const user = { id: "user-1", email: "user@example.com", sessionVersion: 2 } as User;
    mockUserRepository.findOne.mockResolvedValue(user);
    mockUserRepository.save.mockImplementation(async (value: User) => value);
    mockUserNoteRepository.find.mockResolvedValue([]);
    mockRestrictionRepository.find.mockResolvedValue([]);
    mockRecoveryRepository.find.mockResolvedValue([]);
    mockSupportTicketRepository.find.mockResolvedValue([]);

    await service.performRecovery(
      user.id,
      { action: "sessions_revoked", reason: "User reported a lost device" },
      { id: "admin-1", email: "admin@example.com", permissionKeys: ["users.sessions.revoke"] } as any,
      null,
    );

    expect(user.sessionVersion).toBe(3);
    expect(mockRecoveryRepository.save).toHaveBeenCalledWith(expect.objectContaining({
      type: "sessions_revoked",
      status: "completed",
    }));
    expect(mockAuditLogsService.append).toHaveBeenCalledWith(expect.objectContaining({
      action: "admin.users.sessions_revoked",
      metadata: expect.objectContaining({ reason: "User reported a lost device" }),
    }), mockEntityManager);
  });

  it("records and audits a failed recovery delivery without exposing provider details", async () => {
    const user = { id: "user-1", email: "user@example.com", emailVerified: false, sessionVersion: 0 } as User;
    mockUserRepository.findOne.mockResolvedValue(user);
    mockAuthService.forgotPassword.mockRejectedValueOnce(new Error("SMTP unavailable"));

    await expect(service.performRecovery(
      user.id,
      { action: "password_reset", reason: "User requested account recovery" },
      { id: "admin-1", email: "admin@example.com", permissionKeys: ["users.recovery.manage"] } as any,
      null,
    )).rejects.toThrow("SMTP unavailable");

    expect(mockRecoveryRepository.save).toHaveBeenCalledWith(expect.objectContaining({
      type: "password_reset",
      status: "failed",
      deliveryStatus: "failed",
    }));
    expect(mockAuditLogsService.append).toHaveBeenCalledWith(expect.objectContaining({
      action: "admin.users.password_reset",
      metadata: expect.objectContaining({ status: "failed", deliveryStatus: "failed" }),
    }), mockEntityManager);
  });
});
