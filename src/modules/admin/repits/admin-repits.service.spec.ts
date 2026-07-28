import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Repit, Template, User } from "../../../entities";
import { AdminAuditLogsService } from "../audit-logs/admin-audit-logs.service";
import { AdminRepitsService } from "./admin-repits.service";
import { AdminRepitModerationService } from "./admin-repit-moderation.service";

describe("AdminRepitsService", () => {
  const repitRepository = { createQueryBuilder: jest.fn() };
  const userRepository = {};
  const templateRepository = {};
  const auditLogsService = { append: jest.fn().mockResolvedValue(undefined) };
  const moderationService = { openReport: jest.fn(), decide: jest.fn() };
  let service: AdminRepitsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminRepitsService,
        { provide: getRepositoryToken(Repit), useValue: repitRepository },
        { provide: getRepositoryToken(User), useValue: userRepository },
        { provide: getRepositoryToken(Template), useValue: templateRepository },
        { provide: AdminAuditLogsService, useValue: auditLogsService },
        { provide: AdminRepitModerationService, useValue: moderationService },
      ],
    }).compile();
    service = module.get(AdminRepitsService);
    moderationService.openReport.mockResolvedValue({ id: "report-1" });
    moderationService.decide.mockResolvedValue({});
  });

  it("exports filtered repits without media URLs and records an audit event", async () => {
    const qb: any = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([{
        id: "repit-1",
        title: "A, title",
        artist: "Artist",
        status: "published",
        moderationStatus: "active",
        templateId: "matcha-mood",
        template: { name: "Matcha Mood" },
        userId: "user-1",
        user: { fullName: "User One", email: "user@example.com" },
        createdAt: new Date("2026-01-02T00:00:00Z"),
        backgroundPhotoUrl: "https://private.example/photo.jpg",
      }]),
    };
    repitRepository.createQueryBuilder.mockReturnValue(qb);

    const result = await service.exportRepits(
      { templateId: "matcha-mood", status: "active" },
      { id: "admin-1", email: "admin@example.com" } as any,
      null,
    );

    expect(qb.andWhere).toHaveBeenCalledWith("repit.templateId = :templateId", { templateId: "matcha-mood" });
    expect(qb.limit).toHaveBeenCalledWith(10_001);
    expect(result.csv).toContain('"A, title"');
    expect(result.csv).not.toContain("private.example");
    expect(auditLogsService.append).toHaveBeenCalledWith(expect.objectContaining({
      action: "admin.repits.exported",
      metadata: expect.objectContaining({ resultCount: 1, truncated: false, limit: 10_000 }),
    }));
  });

  it("routes the legacy archive endpoint through the policy-backed moderation transaction", async () => {
    jest.spyOn(service, "getRepitDetail").mockResolvedValue({ id: "repit-1" } as never);

    await service.archiveRepit("repit-1", { reason: "Confirmed policy concern" }, { id: "admin-1", email: "admin@example.com" } as any, { requestId: "request-1" } as any);

    expect(moderationService.openReport).toHaveBeenCalledWith("repit-1", { reason: "Confirmed policy concern" }, expect.anything(), expect.anything());
    expect(moderationService.decide).toHaveBeenCalledWith("repit-1", expect.objectContaining({ action: "archive", policyKey: "content.other", reportId: "report-1" }), expect.anything(), expect.anything());
  });

  it("routes the legacy delete endpoint through the policy-backed moderation transaction", async () => {
    await expect(service.deleteRepit("repit-1", { reason: "Confirmed removal requirement" }, { id: "admin-1", email: "admin@example.com" } as any, { requestId: "request-2" } as any))
      .resolves.toEqual({ success: true, repitId: "repit-1" });

    expect(moderationService.decide).toHaveBeenCalledWith("repit-1", expect.objectContaining({ action: "remove", policyKey: "content.other", reportId: "report-1" }), expect.anything(), expect.anything());
  });
});
