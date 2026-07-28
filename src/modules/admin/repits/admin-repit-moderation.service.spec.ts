import { ConflictException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { DataSource, QueryFailedError } from "typeorm";
import {
  AdminAuditLog,
  AdminUser,
  ContactSubmission,
  Repit,
  RepitModerationDecision,
  RepitModerationNote,
  RepitModerationReport,
  UserRestriction,
} from "../../../entities";
import { AdminAuditLogsService } from "../audit-logs/admin-audit-logs.service";
import { AdminRepitModerationService } from "./admin-repit-moderation.service";

describe("AdminRepitModerationService", () => {
  const repit = { id: "repit-1", userId: "user-1", templateId: "echo-room", title: "Echo", status: "published", moderationStatus: "active", flagReason: null } as Repit;
  const reportRepository = { findOne: jest.fn(), find: jest.fn(), create: jest.fn((value) => value), save: jest.fn() };
  const noteRepository = { find: jest.fn(), create: jest.fn((value) => value), save: jest.fn() };
  const decisionRepository = { findOne: jest.fn(), find: jest.fn(), create: jest.fn((value) => value), save: jest.fn() };
  const repitRepository = { findOne: jest.fn(), save: jest.fn() };
  const auditRepository = { createQueryBuilder: jest.fn() };
  const supportRepository = { createQueryBuilder: jest.fn(), create: jest.fn((value) => value), save: jest.fn() };
  const restrictionRepository = { find: jest.fn() };
  const adminRepository = { findOne: jest.fn(), find: jest.fn() };
  const auditService = { append: jest.fn() };
  const manager = {
    getRepository: jest.fn((entity) => {
      if (entity === Repit) return repitRepository;
      if (entity === RepitModerationReport) return reportRepository;
      if (entity === RepitModerationNote) return noteRepository;
      if (entity === RepitModerationDecision) return decisionRepository;
      if (entity === ContactSubmission) return supportRepository;
      if (entity === AdminUser) return adminRepository;
      if (entity === AdminAuditLog) return auditRepository;
      throw new Error(`Unexpected repository ${entity?.name ?? entity}`);
    }),
  };
  const dataSource = { transaction: jest.fn(async (callback) => callback(manager)) };
  let service: AdminRepitModerationService;

  beforeEach(async () => {
    jest.clearAllMocks();
    Object.assign(repit, { moderationStatus: "active", flagReason: null, archivedAt: null, deletedByAdminAt: null });
    repitRepository.findOne.mockResolvedValue(repit);
    repitRepository.save.mockImplementation(async (value) => value);
    reportRepository.findOne.mockResolvedValue(null);
    reportRepository.save.mockImplementation(async (value) => ({ id: "report-1", createdAt: new Date(), updatedAt: new Date(), ...value }));
    decisionRepository.save.mockImplementation(async (value) => ({ id: "decision-1", createdAt: new Date(), ...value }));
    adminRepository.find.mockResolvedValue([]);
    adminRepository.findOne.mockResolvedValue(null);
    auditService.append.mockResolvedValue(undefined);

    const module = await Test.createTestingModule({
      providers: [
        AdminRepitModerationService,
        { provide: getRepositoryToken(RepitModerationReport), useValue: reportRepository },
        { provide: getRepositoryToken(RepitModerationNote), useValue: noteRepository },
        { provide: getRepositoryToken(RepitModerationDecision), useValue: decisionRepository },
        { provide: getRepositoryToken(Repit), useValue: repitRepository },
        { provide: getRepositoryToken(AdminAuditLog), useValue: auditRepository },
        { provide: getRepositoryToken(ContactSubmission), useValue: supportRepository },
        { provide: getRepositoryToken(UserRestriction), useValue: restrictionRepository },
        { provide: getRepositoryToken(AdminUser), useValue: adminRepository },
        { provide: DataSource, useValue: dataSource },
        { provide: AdminAuditLogsService, useValue: auditService },
      ],
    }).compile();
    service = module.get(AdminRepitModerationService);
  });

  it("opens one immutable evidence report and moves the Repit into reported state", async () => {
    const result = await service.openReport(repit.id, {
      reason: "Potential policy breach",
      reportType: "safety",
      priority: "high",
      evidenceComment: "Captured from the Repit detail workspace",
    }, { id: "admin-1", email: "reviewer@example.com" } as any, null);

    expect(result.id).toBe("report-1");
    expect(repit.moderationStatus).toBe("reported");
    expect(reportRepository.save).toHaveBeenCalledWith(expect.objectContaining({
      repitId: repit.id,
      reportType: "safety",
      priority: "high",
      evidence: expect.objectContaining({ capturedAt: expect.any(String), intakeComment: "Captured from the Repit detail workspace" }),
    }));
    expect(auditService.append).toHaveBeenCalledWith(expect.objectContaining({ action: "admin.repits.report_opened" }), manager);
  });

  it("returns only active administrators with moderation review permission", async () => {
    adminRepository.find.mockResolvedValue([
      { id: "reviewer-1", fullName: "Reviewer One", email: "reviewer@example.com", roles: [{ permissions: [{ key: "repits.review" }] }] },
      { id: "admin-2", fullName: "Other Admin", email: "other@example.com", roles: [{ permissions: [{ key: "users.read" }] }] },
    ]);

    await expect(service.listReviewers()).resolves.toEqual({
      records: [{ id: "reviewer-1", fullName: "Reviewer One", email: "reviewer@example.com" }],
    });
  });

  it("does not allow a reviewer to steal another reviewer assignment", async () => {
    reportRepository.findOne.mockResolvedValue({ id: "report-1", repitId: repit.id, status: "under_review", assignedAdminUserId: "admin-2" });

    await expect(service.assignReport("report-1", { action: "claim" }, { id: "admin-1", email: "reviewer@example.com" } as any, null))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it("rejects assignment to an administrator without moderation review permission", async () => {
    reportRepository.findOne.mockResolvedValue({ id: "report-1", repitId: repit.id, status: "open", assignedAdminUserId: null });
    adminRepository.findOne.mockResolvedValue({ id: "admin-2", email: "other@example.com", roles: [{ permissions: [{ key: "users.read" }] }] });

    await expect(service.assignReport("report-1", { action: "assign", assigneeAdminUserId: "admin-2", reason: "Queue balancing" }, { id: "admin-1", email: "reviewer@example.com" } as any, null))
      .rejects.toThrow("Assignee is not eligible");
  });

  it("returns released content to reported state and writes the correct audit action", async () => {
    reportRepository.findOne.mockResolvedValue({ id: "report-1", repitId: repit.id, status: "under_review", assignedAdminUserId: "admin-1", claimedAt: new Date() });
    repit.moderationStatus = "under_review";

    await service.assignReport("report-1", { action: "release", reason: "Return to queue" }, { id: "admin-1", email: "reviewer@example.com" } as any, null);

    expect(repit.moderationStatus).toBe("reported");
    expect(auditService.append).toHaveBeenCalledWith(expect.objectContaining({ action: "admin.repits.report_released" }), manager);
  });

  it("archives content through a policy-backed, transactional and audited decision", async () => {
    reportRepository.findOne.mockResolvedValue({ id: "report-1", repitId: repit.id, status: "under_review", priority: "high" });
    jest.spyOn(service, "getModerationContext").mockResolvedValue({ decisions: [] } as never);

    await service.decide(repit.id, {
      reportId: "report-1",
      action: "archive",
      reason: "Confirmed policy violation",
      policyKey: "content.harassment",
      idempotencyKey: "decision-request-1",
    }, { id: "admin-1", email: "reviewer@example.com" } as any, null);

    expect(repit.moderationStatus).toBe("archived");
    expect(decisionRepository.save).toHaveBeenCalledWith(expect.objectContaining({
      action: "archive",
      policyKey: "content.harassment",
      policyVersion: 1,
      previousStatus: "active",
      resultingStatus: "archived",
    }));
    expect(auditService.append).toHaveBeenCalledWith(expect.objectContaining({ action: "admin.repits.decision_archive" }), manager);
  });

  // ── Remediation: permission-shaping at the response boundary ──────────────
  function stubContextReads() {
    reportRepository.find.mockResolvedValue([]);
    noteRepository.find.mockResolvedValue([]);
    decisionRepository.find.mockResolvedValue([]);
    restrictionRepository.find.mockResolvedValue([{ id: "restr-1", type: "content", status: "active", reason: "policy", createdAt: new Date() }]);
    const supportQb = { where: jest.fn().mockReturnThis(), orderBy: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), getMany: jest.fn().mockResolvedValue([{ id: "ticket-1", subject: "Escalation", status: "new", priority: "high", createdAt: new Date() }]) };
    supportRepository.createQueryBuilder.mockReturnValue(supportQb);
  }

  it("omits support + restriction context when the reviewer lacks the sensitive permissions", async () => {
    stubContextReads();
    const context = await service.getModerationContext(repit.id, { id: "admin-1", email: "r@e.com", permissionKeys: ["repits.review"] } as any);
    expect(context.supportContextAvailable).toBe(false);
    expect(context.supportCases).toEqual([]);
    expect(context.restrictionContextAvailable).toBe(false);
    expect(context.userRestrictions).toEqual([]);
    // Sensitive data is never even queried without permission.
    expect(supportRepository.createQueryBuilder).not.toHaveBeenCalled();
    expect(restrictionRepository.find).not.toHaveBeenCalled();
  });

  it("returns support + restriction context to a reviewer holding the sensitive permissions", async () => {
    stubContextReads();
    const context = await service.getModerationContext(repit.id, { id: "admin-1", email: "r@e.com", permissionKeys: ["repits.review", "support.sensitive_context.read", "users.restrictions.manage"] } as any);
    expect(context.supportContextAvailable).toBe(true);
    expect(context.supportCases).toHaveLength(1);
    expect(context.restrictionContextAvailable).toBe(true);
    expect(context.userRestrictions).toHaveLength(1);
  });

  // ── Remediation: decision concurrency + idempotency ───────────────────────
  it("rejects a decision against an already-resolved report with a conflict", async () => {
    reportRepository.findOne.mockResolvedValue({ id: "report-1", repitId: repit.id, status: "resolved", priority: "high" });
    await expect(service.decide(repit.id, {
      reportId: "report-1", action: "archive", reason: "late decision", policyKey: "content.harassment",
    }, { id: "admin-1", email: "r@e.com" } as any, null)).rejects.toBeInstanceOf(ConflictException);
    expect(decisionRepository.save).not.toHaveBeenCalled();
  });

  it("treats a replayed idempotency key as a no-op returning existing context", async () => {
    decisionRepository.findOne.mockResolvedValue({ id: "decision-1", repitId: repit.id, idempotencyKey: "dup-key" });
    const spy = jest.spyOn(service, "getModerationContext").mockResolvedValue({ decisions: [] } as never);
    await service.decide(repit.id, {
      reportId: "report-1", action: "archive", reason: "same request", policyKey: "content.harassment", idempotencyKey: "dup-key",
    }, { id: "admin-1", email: "r@e.com" } as any, null);
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(decisionRepository.save).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("recovers only after confirming the committed decision belongs to this Repit on a 23505 race", async () => {
    reportRepository.findOne.mockResolvedValue({ id: "report-1", repitId: repit.id, status: "under_review", priority: "high" });
    // Pre-check finds nothing; the transaction loses the unique-index race; the
    // catch confirms a real winner exists for this key AND this Repit.
    decisionRepository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "decision-1", repitId: repit.id, idempotencyKey: "race-key" });
    dataSource.transaction.mockRejectedValueOnce(new QueryFailedError("insert", undefined as never, { code: "23505" } as never));
    const spy = jest.spyOn(service, "getModerationContext").mockResolvedValue({ decisions: [] } as never);
    await expect(service.decide(repit.id, {
      reportId: "report-1", action: "archive", reason: "raced", policyKey: "content.harassment", idempotencyKey: "race-key",
    }, { id: "admin-1", email: "r@e.com" } as any, null)).resolves.toBeDefined();
    spy.mockRestore();
  });

  it("rejects a cross-Repit idempotency-key collision instead of falsely reporting success", async () => {
    reportRepository.findOne.mockResolvedValue({ id: "report-1", repitId: repit.id, status: "under_review", priority: "high" });
    // Pre-check finds nothing here; the winner committed under a DIFFERENT Repit.
    decisionRepository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "decision-x", repitId: "other-repit", idempotencyKey: "shared-key" });
    dataSource.transaction.mockRejectedValueOnce(new QueryFailedError("insert", undefined as never, { code: "23505" } as never));
    await expect(service.decide(repit.id, {
      reportId: "report-1", action: "archive", reason: "collision", policyKey: "content.harassment", idempotencyKey: "shared-key",
    }, { id: "admin-1", email: "r@e.com" } as any, null)).rejects.toBeInstanceOf(ConflictException);
  });
});
