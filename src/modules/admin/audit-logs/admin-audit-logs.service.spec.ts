import type { Repository } from "typeorm";
import { AdminAuditLog } from "../../../entities/admin-audit-log.entity";
import { AdminAuditLogsService } from "./admin-audit-logs.service";

describe("AdminAuditLogsService", () => {
  const queryBuilder = {
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn(),
    getMany: jest.fn(),
  };
  const repository = {
    createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    findOne: jest.fn(),
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => value),
    find: jest.fn(),
    count: jest.fn(),
  };
  let service: AdminAuditLogsService;
  const actor = {
    id: "admin-1",
    email: "admin@example.com",
    fullName: "QA Admin",
    status: "active",
    roleKeys: ["super-admin"],
    permissionKeys: ["audit.read", "audit.export"],
  };

  const record = {
    id: "audit-1",
    actorAdminUserId: "admin-1",
    actorEmail: "admin@example.com",
    action: "admin.users.updated",
    targetType: "user",
    targetId: "user-1",
    requestId: "request-1",
    method: "PATCH",
    path: "/api/admin/users/user-1",
    beforeState: { email: "old@example.com", passwordHash: "hidden" },
    afterState: { email: "new@example.com", passwordHash: "still-hidden" },
    metadata: { reason: "Correction", accessToken: "hidden" },
    createdAt: new Date("2026-07-20T10:00:00.000Z"),
  } as AdminAuditLog;

  beforeEach(() => {
    jest.clearAllMocks();
    repository.createQueryBuilder.mockReturnValue(queryBuilder);
    repository.create.mockImplementation((value) => value);
    repository.save.mockImplementation(async (value) => value);
    service = new AdminAuditLogsService(repository as unknown as Repository<AdminAuditLog>);
  });

  it("applies filters and returns a server-paginated safe list", async () => {
    queryBuilder.getManyAndCount.mockResolvedValue([[record], 1]);

    const result = await service.list({
      search: "users",
      module: "users",
      actor: "admin@",
      targetType: "user",
      createdFrom: "2026-07-01",
      createdTo: "2026-07-31",
      page: 2,
      pageSize: 20,
      sortOrder: "asc",
    });

    expect(queryBuilder.andWhere).toHaveBeenCalledTimes(6);
    expect(queryBuilder.skip).toHaveBeenCalledWith(20);
    expect(queryBuilder.take).toHaveBeenCalledWith(20);
    expect(queryBuilder.orderBy).toHaveBeenCalledWith("audit.createdAt", "ASC");
    expect(result).toEqual(expect.objectContaining({ total: 1, page: 2, pageSize: 20 }));
    expect(result.records[0]).not.toHaveProperty("beforeState");
    expect(result.records[0]).not.toHaveProperty("ipAddress");
  });

  it("redacts sensitive values and computes a field-level change set", async () => {
    repository.findOne.mockResolvedValue(record);

    const result = await service.getDetail(
      record.id,
      { ...actor, id: "reviewer-1", email: "reviewer@example.com" },
      { requestId: "view-1", method: "GET", path: "/api/admin/audit-logs/audit-1", ipAddress: null, userAgent: null },
    );

    expect(result.beforeState).toEqual(expect.objectContaining({ passwordHash: "[REDACTED]" }));
    expect(result.afterState).toEqual(expect.objectContaining({ passwordHash: "[REDACTED]" }));
    expect(result.metadata).toEqual(expect.objectContaining({ accessToken: "[REDACTED]" }));
    expect(result.changes).toContainEqual(expect.objectContaining({ path: "email", kind: "changed" }));
    expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({
      action: "admin.audit.viewed",
      targetType: "audit_log",
      targetId: record.id,
    }));
  });

  it("exports safe columns, neutralizes formulas, and audits the export", async () => {
    queryBuilder.getMany.mockResolvedValue([{ ...record, actorEmail: "=HYPERLINK(\"bad\")" }]);

    const result = await service.export(
      { module: "users", sortOrder: "desc" },
      actor,
      null,
    );

    expect(queryBuilder.take).toHaveBeenCalledWith(5_001);
    expect(result.csv).toContain("'=HYPERLINK");
    expect(result.csv).not.toContain("passwordHash");
    expect(result.resultCount).toBe(1);
    expect(result.truncated).toBe(false);
    expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({
      action: "admin.audit.exported",
      metadata: expect.objectContaining({ resultCount: 1, truncated: false, limit: 5_000 }),
    }));
  });
});
