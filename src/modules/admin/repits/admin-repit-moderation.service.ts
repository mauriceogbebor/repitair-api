import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, QueryFailedError, Repository } from "typeorm";
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
import type { AdminRequestActor, AdminRequestContext } from "../admin.types";
import { AdminAddModerationNoteDto } from "./dto/admin-add-moderation-note.dto";
import { AdminAssignModerationReportDto } from "./dto/admin-assign-moderation-report.dto";
import { AdminListModerationReportsQueryDto } from "./dto/admin-list-moderation-reports-query.dto";
import { AdminModerationDecisionDto } from "./dto/admin-moderation-decision.dto";
import { AdminOpenModerationReportDto } from "./dto/admin-open-moderation-report.dto";
import { findModerationPolicy, MODERATION_POLICIES } from "./moderation-policies";
import { resolveDateRange } from "../utils/date-range";

/** Sensitive linked context is gated at the response boundary, not just the UI. */
const SUPPORT_CONTEXT_PERMISSION = "support.sensitive_context.read";
const RESTRICTION_CONTEXT_PERMISSION = "users.restrictions.manage";
const ACTIVE_REPORT_STATUSES = ["open", "under_review", "escalated"] as const;

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

@Injectable()
export class AdminRepitModerationService {
  constructor(
    @InjectRepository(RepitModerationReport) private readonly reportRepository: Repository<RepitModerationReport>,
    @InjectRepository(RepitModerationNote) private readonly noteRepository: Repository<RepitModerationNote>,
    @InjectRepository(RepitModerationDecision) private readonly decisionRepository: Repository<RepitModerationDecision>,
    @InjectRepository(Repit) private readonly repitRepository: Repository<Repit>,
    @InjectRepository(AdminAuditLog) private readonly auditRepository: Repository<AdminAuditLog>,
    @InjectRepository(ContactSubmission) private readonly supportRepository: Repository<ContactSubmission>,
    @InjectRepository(UserRestriction) private readonly restrictionRepository: Repository<UserRestriction>,
    @InjectRepository(AdminUser) private readonly adminUserRepository: Repository<AdminUser>,
    private readonly dataSource: DataSource,
    private readonly auditLogsService: AdminAuditLogsService,
  ) {}

  listPolicies() {
    return { records: MODERATION_POLICIES };
  }

  async listReviewers() {
    const admins = await this.adminUserRepository.find({
      where: { status: "active" },
      order: { fullName: "ASC" },
    });
    return {
      records: admins
        .filter((admin) => admin.roles?.some((role) => role.permissions?.some((permission) => permission.key === "repits.review")))
        .map((admin) => ({ id: admin.id, fullName: admin.fullName, email: admin.email })),
    };
  }

  async listReports(query: AdminListModerationReportsQueryDto, actor?: AdminRequestActor | null) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(query.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const { start: dateFrom, endExclusive: dateToExclusive } = resolveDateRange(query.dateFrom, query.dateTo, "report");

    const qb = this.reportRepository
      .createQueryBuilder("report")
      .leftJoin(Repit, "repit", "repit.id = report.repitId")
      .leftJoin("users", "creator", "creator.id = repit.userId")
      .leftJoin("templates", "template", "template.id = repit.templateId");
    this.applyReportFilters(qb, query, dateFrom, dateToExclusive);
    const total = await qb.getCount();

    qb.select([
      "report.id AS id",
      'report."repitId" AS repit_id',
      'report."reportType" AS report_type',
      "report.priority AS priority",
      "report.status AS status",
      "report.reason AS reason",
      'report."reporterType" AS reporter_type',
      'report."assignedAdminUserId" AS assigned_admin_user_id',
      'report."assignedAdminEmail" AS assigned_admin_email',
      'report."escalationTarget" AS escalation_target',
      'report."createdAt" AS created_at',
      'report."updatedAt" AS updated_at',
      "repit.title AS repit_title",
      'repit."userId" AS creator_id',
      'repit."moderationStatus" AS moderation_status',
      'repit."templateId" AS template_id',
      "creator.\"fullName\" AS creator_name",
      "creator.email AS creator_email",
      "template.name AS template_name",
    ]);
    this.applyReportSorting(qb, query.sortBy, query.sortOrder);
    qb.offset((page - 1) * pageSize).limit(pageSize);
    const rows = await qb.getRawMany<Record<string, unknown>>();
    const canReadPii = Boolean(actor?.permissionKeys?.includes("users.read_pii"));

    return {
      total,
      page,
      pageSize,
      records: rows.map((row) => ({
        id: String(row.id),
        repit: {
          id: String(row.repit_id),
          title: String(row.repit_title ?? "Unavailable Repit"),
          moderationStatus: String(row.moderation_status ?? "unknown"),
        },
        creator: {
          id: row.creator_id ? String(row.creator_id) : null,
          fullName: row.creator_name ? String(row.creator_name) : "Unknown user",
          email: canReadPii && row.creator_email ? String(row.creator_email) : null,
        },
        template: { id: String(row.template_id ?? ""), name: String(row.template_name ?? row.template_id ?? "Unknown") },
        reportType: String(row.report_type),
        priority: String(row.priority),
        status: String(row.status),
        reason: String(row.reason),
        reporterType: String(row.reporter_type),
        assignee: row.assigned_admin_user_id || row.assigned_admin_email
          ? { id: row.assigned_admin_user_id ? String(row.assigned_admin_user_id) : null, email: row.assigned_admin_email ? String(row.assigned_admin_email) : null }
          : null,
        escalationTarget: row.escalation_target ? String(row.escalation_target) : null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        ageMinutes: Math.max(0, Math.floor((Date.now() - new Date(String(row.created_at)).getTime()) / 60_000)),
      })),
    };
  }

  async openReport(
    repitId: string,
    input: Pick<AdminOpenModerationReportDto, "reason"> & Partial<AdminOpenModerationReportDto>,
    actor?: AdminRequestActor | null,
    context?: AdminRequestContext | null,
  ) {
    const existing = await this.reportRepository.findOne({
      where: [
        { repitId, status: "open" },
        { repitId, status: "under_review" },
        { repitId, status: "escalated" },
      ],
      order: { createdAt: "DESC" },
    });
    if (existing) return existing;

    try {
      return await this.dataSource.transaction(async (manager) => {
        const repitRepository = manager.getRepository(Repit);
        const reportRepository = manager.getRepository(RepitModerationReport);
        const repit = await repitRepository.findOne({ where: { id: repitId } });
        if (!repit) throw new NotFoundException("Repit not found");
        const previousStatus = repit.moderationStatus;
        repit.moderationStatus = "reported";
        repit.flagReason = input.reason.trim();
        await repitRepository.save(repit);
        const report = await reportRepository.save(reportRepository.create({
          repitId,
          reporterType: "admin",
          reportType: input.reportType?.trim() || "other",
          priority: input.priority ?? "medium",
          status: "open",
          reason: input.reason.trim(),
          evidence: {
            capturedAt: new Date().toISOString(),
            intakeComment: input.evidenceComment?.trim() || null,
            repit: { id: repit.id, templateId: repit.templateId, publicationStatus: repit.status, previousModerationStatus: previousStatus },
          },
          assignedAdminUserId: null,
          assignedAdminEmail: null,
        }));
        await this.auditLogsService.append({
          action: "admin.repits.report_opened",
          actor,
          context,
          targetType: "repit",
          targetId: repitId,
          beforeState: { moderationStatus: previousStatus },
          afterState: { moderationStatus: repit.moderationStatus },
          metadata: { reportId: report.id, reportType: report.reportType, priority: report.priority },
        }, manager);
        return report;
      });
    } catch (error) {
      if (error instanceof QueryFailedError && (error as QueryFailedError & { driverError?: { code?: string } }).driverError?.code === "23505") {
        const concurrent = await this.findActiveReport(repitId);
        if (concurrent) return concurrent;
      }
      throw error;
    }
  }

  async getModerationContext(repitId: string, actor?: AdminRequestActor | null) {
    const repit = await this.repitRepository.findOne({ where: { id: repitId }, relations: { user: true, template: true } });
    if (!repit) throw new NotFoundException("Repit not found");
    const reports = await this.reportRepository.find({ where: { repitId }, order: { createdAt: "DESC" }, take: 100 });
    const reportIds = reports.map((report) => report.id);

    // Sensitive linked context is gated at the RESPONSE BOUNDARY: unauthorized
    // sections are neither queried nor returned, so direct API access cannot
    // bypass the shaping. Availability flags let the UI distinguish "none" from
    // "not permitted" without leaking the underlying data.
    const canSupportContext = Boolean(actor?.permissionKeys?.includes(SUPPORT_CONTEXT_PERMISSION));
    const canRestrictionContext = Boolean(actor?.permissionKeys?.includes(RESTRICTION_CONTEXT_PERMISSION));

    const [notes, decisions, supportCases, restrictions, auditLogs] = await Promise.all([
      this.noteRepository.find({ where: { repitId }, order: { createdAt: "DESC" }, take: 100 }),
      this.decisionRepository.find({ where: { repitId }, order: { createdAt: "DESC" }, take: 100 }),
      canSupportContext
        ? this.supportRepository.createQueryBuilder("ticket")
            .where(':repitId = ANY(ticket."relatedRepitIds")', { repitId })
            .orderBy('ticket."createdAt"', "DESC").limit(50).getMany()
        : Promise.resolve([]),
      canRestrictionContext && repit.userId
        ? this.restrictionRepository.find({ where: { userId: repit.userId }, order: { createdAt: "DESC" }, take: 50 })
        : Promise.resolve([]),
      actor?.permissionKeys?.includes("repits.audit")
        ? this.auditRepository.createQueryBuilder("audit")
            .where('(audit."targetType" = :targetType AND audit."targetId" = :repitId)', { targetType: "repit", repitId })
            .orWhere(reportIds.length ? '(audit."targetType" = :reportType AND audit."targetId" IN (:...reportIds))' : "1 = 0", { reportType: "moderation_report", reportIds })
            .orderBy('audit."createdAt"', "DESC").limit(100).getMany()
        : Promise.resolve([]),
    ]);

    return {
      reports: reports.map((report) => this.serializeReport(report, true)),
      notes: actor?.permissionKeys?.includes("repits.notes") ? notes.map((note) => ({
        id: note.id, reportId: note.reportId ?? null, body: note.body,
        authorEmail: note.authorAdminEmail ?? null, createdAt: note.createdAt,
      })) : [],
      decisions: decisions.map((decision) => ({
        id: decision.id, reportId: decision.reportId ?? null, action: decision.action, reason: decision.reason,
        policy: { key: decision.policyKey, version: decision.policyVersion, category: decision.policyCategory, severity: decision.severity },
        previousStatus: decision.previousStatus, resultingStatus: decision.resultingStatus,
        actorEmail: decision.actorAdminEmail ?? null, createdAt: decision.createdAt,
      })),
      supportContextAvailable: canSupportContext,
      supportCases: supportCases.map((ticket) => ({ id: ticket.id, subject: ticket.subject, status: ticket.status, priority: ticket.priority, createdAt: ticket.createdAt })),
      restrictionContextAvailable: canRestrictionContext,
      userRestrictions: restrictions.map((restriction) => ({ id: restriction.id, type: restriction.type, status: restriction.status, reason: restriction.reason, createdAt: restriction.createdAt })),
      auditHistory: auditLogs.map((audit) => ({ id: audit.id, action: audit.action, actorEmail: audit.actorEmail ?? null, requestId: audit.requestId ?? null, createdAt: audit.createdAt })),
      appeals: { supported: false, records: [] },
    };
  }

  async assignReport(reportId: string, dto: AdminAssignModerationReportDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    // Resolve the owning Repit id outside the lock so we can acquire locks in the
    // CANONICAL order (Repit first, then report) — identical to decide() — which
    // prevents a deadlock between concurrent assignment and decision requests.
    const preview = await this.reportRepository.findOne({ where: { id: reportId } });
    if (!preview) throw new NotFoundException("Moderation report not found");

    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(RepitModerationReport);
      const repitRepository = manager.getRepository(Repit);
      // Canonical lock order: Repit row first, then the report row. Ownership is
      // re-read UNDER the lock, so simultaneous claims cannot silently overwrite.
      const repit = await repitRepository.findOne({ where: { id: preview.repitId }, lock: { mode: "pessimistic_write" } });
      const report = await repository.findOne({ where: { id: reportId }, lock: { mode: "pessimistic_write" } });
      if (!report) throw new NotFoundException("Moderation report not found");
      if (report.status === "resolved") throw new ConflictException("Resolved reports cannot be reassigned");
      const beforeState = this.assignmentSnapshot(report);
      const wasUnderReview = report.status === "under_review";

      if (dto.action === "release") {
        report.assignedAdminUserId = null;
        report.assignedAdminEmail = null;
        report.claimedAt = null;
        if (report.status === "under_review") report.status = "open";
        if (wasUnderReview && repit?.moderationStatus === "under_review") {
          repit.moderationStatus = "reported";
          await repitRepository.save(repit);
        }
      } else {
        let assignee: { id: string; email: string };
        if (dto.action === "claim") {
          if (!actor) throw new ConflictException("Admin actor is required to claim a report");
          if (report.assignedAdminUserId && report.assignedAdminUserId !== actor.id) {
            throw new ConflictException("This report is assigned to another reviewer");
          }
          assignee = actor;
        } else {
          const admin = await manager.getRepository(AdminUser).findOne({ where: { id: dto.assigneeAdminUserId, status: "active" } });
          if (!admin) throw new NotFoundException("Active assignee not found");
          if (!admin.roles?.some((role) => role.permissions?.some((permission) => permission.key === "repits.review"))) {
            throw new BadRequestException("Assignee is not eligible to review moderation reports");
          }
          assignee = admin;
        }
        report.assignedAdminUserId = assignee.id;
        report.assignedAdminEmail = assignee.email;
        report.claimedAt = new Date();
        if (report.status !== "escalated") report.status = "under_review";
        if (repit && ["reported", "flagged"].includes(repit.moderationStatus)) {
          repit.moderationStatus = "under_review";
          await repitRepository.save(repit);
        }
      }
      await repository.save(report);
      const auditAction = { assign: "assigned", claim: "claimed", release: "released" }[dto.action];
      await this.auditLogsService.append({
        action: `admin.repits.report_${auditAction}`, actor, context,
        targetType: "moderation_report", targetId: report.id,
        beforeState, afterState: this.assignmentSnapshot(report), metadata: dto.reason ? { reason: dto.reason } : null,
      }, manager);
    });
    return this.requireReport(reportId);
  }

  async addNote(repitId: string, dto: AdminAddModerationNoteDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    await this.requireRepit(repitId);
    if (dto.reportId) {
      const report = await this.requireReport(dto.reportId);
      if (report.repitId !== repitId) throw new BadRequestException("Report does not belong to this Repit");
    }
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(RepitModerationNote);
      const note = await repository.save(repository.create({
        repitId, reportId: dto.reportId ?? null, body: dto.body.trim(),
        authorAdminUserId: actor?.id ?? null, authorAdminEmail: actor?.email ?? null,
      }));
      await this.auditLogsService.append({
        action: "admin.repits.moderation_note_added", actor, context,
        targetType: "repit", targetId: repitId,
        metadata: { noteId: note.id, reportId: note.reportId ?? null },
      }, manager);
    });
    return this.getModerationContext(repitId, actor);
  }

  async decide(repitId: string, dto: AdminModerationDecisionDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    const policy = findModerationPolicy(dto.policyKey);
    if (!policy) throw new BadRequestException("Unknown moderation policy");
    if (dto.idempotencyKey) {
      const existing = await this.decisionRepository.findOne({ where: { idempotencyKey: dto.idempotencyKey } });
      if (existing) {
        if (existing.repitId !== repitId) throw new ConflictException("Idempotency key already used");
        return this.getModerationContext(repitId, actor);
      }
    }

    try {
      await this.dataSource.transaction(async (manager) => {
      const repitRepository = manager.getRepository(Repit);
      const reportRepository = manager.getRepository(RepitModerationReport);
      // Acquire pessimistic write locks so two reviewers cannot apply conflicting
      // decisions to the same report/Repit; status is revalidated under the lock.
      const repit = await repitRepository.findOne({ where: { id: repitId }, relations: { user: true }, lock: { mode: "pessimistic_write" } });
      if (!repit) throw new NotFoundException("Repit not found");
      const report = await reportRepository.findOne({ where: { id: dto.reportId, repitId }, lock: { mode: "pessimistic_write" } });
      if (!report) throw new NotFoundException("Moderation report not found for this Repit");
      if (report.status === "resolved") throw new ConflictException("This report is already resolved");
      const previousStatus = repit.moderationStatus;

      if (dto.action === "dismiss") {
        repit.moderationStatus = "active";
        repit.flagReason = null;
        report.status = "resolved";
        report.resolvedAt = new Date();
      } else if (dto.action === "archive") {
        repit.moderationStatus = "archived";
        repit.archivedAt = new Date();
        repit.flagReason = dto.reason.trim();
        report.status = "resolved";
        report.resolvedAt = new Date();
      } else if (dto.action === "remove") {
        repit.moderationStatus = "deleted";
        repit.deletedByAdminAt = new Date();
        repit.flagReason = dto.reason.trim();
        report.status = "resolved";
        report.resolvedAt = new Date();
      } else {
        repit.moderationStatus = "under_review";
        report.status = "escalated";
        report.escalationTarget = dto.action === "forward_support" ? "support" : dto.escalationTarget ?? "compliance";
        if (dto.action === "forward_support") {
          const supportRepository = manager.getRepository(ContactSubmission);
          const existingSupportCase = await supportRepository.createQueryBuilder("ticket")
            .where('ticket."sourceReferenceType" = :sourceReferenceType', { sourceReferenceType: "moderation_report" })
            .andWhere('ticket."sourceReferenceId" = :sourceReferenceId', { sourceReferenceId: report.id })
            .andWhere("ticket.status NOT IN ('resolved', 'closed')")
            .getOne();
          if (!existingSupportCase) {
            const createdAt = new Date();
            await supportRepository.save(supportRepository.create({
              name: repit.user?.fullName ?? "Repit user",
              email: repit.user?.email ?? "unavailable@repitair.invalid",
              subject: `Moderation escalation for ${repit.title}`,
              message: dto.reason.trim(), status: "new", priority: report.priority,
              category: "content", subcategory: "moderation_handoff", tags: ["moderation", policy.category],
              relatedUserId: repit.userId, relatedRepitIds: [repit.id], relatedNotificationIds: [],
              relatedModerationReportId: report.id,
              sourceReferenceType: "moderation_report", sourceReferenceId: report.id,
              firstResponseDueAt: new Date(createdAt.getTime() + 4 * 60 * 60 * 1000),
              resolutionDueAt: new Date(createdAt.getTime() + 48 * 60 * 60 * 1000),
              source: "moderation",
            }));
          }
        }
      }

      await repitRepository.save(repit);
      await reportRepository.save(report);
      const decision = await manager.getRepository(RepitModerationDecision).save(manager.getRepository(RepitModerationDecision).create({
        repitId, reportId: report.id, action: dto.action, reason: dto.reason.trim(),
        policyKey: policy.key, policyVersion: policy.version, policyCategory: policy.category, severity: policy.severity,
        previousStatus, resultingStatus: repit.moderationStatus, idempotencyKey: dto.idempotencyKey ?? null,
        actorAdminUserId: actor?.id ?? null, actorAdminEmail: actor?.email ?? null,
      }));
      await this.auditLogsService.append({
        action: `admin.repits.decision_${dto.action}`, actor, context,
        targetType: "repit", targetId: repitId,
        beforeState: { moderationStatus: previousStatus }, afterState: { moderationStatus: repit.moderationStatus },
        metadata: { decisionId: decision.id, reportId: report.id, reason: dto.reason, policy: { key: policy.key, version: policy.version, category: policy.category, severity: policy.severity }, escalationTarget: report.escalationTarget ?? null },
      }, manager);
      });
    } catch (error) {
      // A concurrent request that shared the same idempotency key lost the race
      // on the unique index. Recover ONLY after confirming a committed decision
      // actually exists for this key AND belongs to this Repit — otherwise a
      // cross-Repit key collision (or an unrelated 23505) would be falsely
      // reported as success for a decision that was rolled back.
      if (dto.idempotencyKey && error instanceof QueryFailedError && (error as QueryFailedError & { driverError?: { code?: string } }).driverError?.code === "23505") {
        const winner = await this.decisionRepository.findOne({ where: { idempotencyKey: dto.idempotencyKey } });
        if (winner && winner.repitId === repitId) return this.getModerationContext(repitId, actor);
        if (winner && winner.repitId !== repitId) throw new ConflictException("Idempotency key already used");
      }
      throw error;
    }
    return this.getModerationContext(repitId, actor);
  }

  private applyReportFilters(qb: ReturnType<Repository<RepitModerationReport>["createQueryBuilder"]>, query: AdminListModerationReportsQueryDto, dateFrom: Date | null, dateToExclusive: Date | null) {
    if (query.search?.trim()) qb.andWhere('(report.id::text ILIKE :search OR report."repitId"::text ILIKE :search OR report.reason ILIKE :search OR repit.title ILIKE :search)', { search: `%${query.search.trim()}%` });
    if (query.status) qb.andWhere("report.status = :status", { status: query.status });
    if (query.priority) qb.andWhere("report.priority = :priority", { priority: query.priority });
    if (query.reportType) qb.andWhere('report."reportType" = :reportType', { reportType: query.reportType });
    if (query.assignedAdminUserId) qb.andWhere('report."assignedAdminUserId" = :assignedAdminUserId', { assignedAdminUserId: query.assignedAdminUserId });
    if (dateFrom) qb.andWhere('report."createdAt" >= :dateFrom', { dateFrom: dateFrom.toISOString() });
    if (dateToExclusive) qb.andWhere('report."createdAt" < :dateToExclusive', { dateToExclusive: dateToExclusive.toISOString() });
  }

  private applyReportSorting(qb: ReturnType<Repository<RepitModerationReport>["createQueryBuilder"]>, sortBy?: string, sortOrder?: string) {
    const order = sortOrder === "asc" ? "ASC" : "DESC";
    if (sortBy === "priority") qb.orderBy("CASE report.priority WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END", order);
    else if (sortBy === "status") qb.orderBy("report.status", order);
    else if (sortBy === "updatedAt") qb.orderBy('report."updatedAt"', order);
    else qb.orderBy('report."createdAt"', order);
  }

  private serializeReport(report: RepitModerationReport, includeEvidence = false) {
    return {
      id: report.id, repitId: report.repitId, reportType: report.reportType,
      priority: report.priority, status: report.status, reason: report.reason,
      reporterType: report.reporterType,
      reporterComment: includeEvidence ? report.reporterComment ?? null : undefined,
      evidence: includeEvidence ? report.evidence ?? null : undefined,
      assignee: report.assignedAdminUserId || report.assignedAdminEmail
        ? { id: report.assignedAdminUserId ?? null, email: report.assignedAdminEmail ?? null }
        : null,
      escalationTarget: report.escalationTarget ?? null, claimedAt: report.claimedAt ?? null,
      resolvedAt: report.resolvedAt ?? null, createdAt: report.createdAt, updatedAt: report.updatedAt,
    };
  }

  private assignmentSnapshot(report: RepitModerationReport) {
    return { status: report.status, assignedAdminUserId: report.assignedAdminUserId ?? null, claimedAt: report.claimedAt?.toISOString?.() ?? null };
  }

  private async requireReport(reportId: string) {
    const report = await this.reportRepository.findOne({ where: { id: reportId } });
    if (!report) throw new NotFoundException("Moderation report not found");
    return this.serializeReport(report);
  }

  private async requireRepit(repitId: string) {
    const repit = await this.repitRepository.findOne({ where: { id: repitId } });
    if (!repit) throw new NotFoundException("Repit not found");
    return repit;
  }

  private findActiveReport(repitId: string) {
    return this.reportRepository.findOne({
      where: [
        { repitId, status: "open" },
        { repitId, status: "under_review" },
        { repitId, status: "escalated" },
      ],
      order: { createdAt: "DESC" },
    });
  }
}
