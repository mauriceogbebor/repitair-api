import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, In, Repository, SelectQueryBuilder } from "typeorm";
import {
  AdminAuditLog,
  AdminUser,
  ContactSubmission,
  NotificationCampaign,
  Repit,
  RepitModerationDecision,
  RepitModerationReport,
  SupportTicketEscalation,
  SupportTicketNote,
  SupportTicketResolution,
  SupportTicketResponse,
  User,
  UserRecoveryOperation,
  UserRestriction,
} from "../../../entities";
import { createHash } from "node:crypto";
import { MailService } from "../../../common/services/mail.service";
import { AdminAuditLogsService } from "../audit-logs/admin-audit-logs.service";
import type { AdminRequestActor, AdminRequestContext } from "../admin.types";
import { createCsv } from "../utils/csv";
import { resolveDateRange } from "../utils/date-range";
import { SUPPORT_STATUS_TRANSITIONS } from "./support-lifecycle.constants";
import { AdminAddSupportTicketNoteDto } from "./dto/admin-add-support-ticket-note.dto";
import { AdminAssignSupportTicketDto } from "./dto/admin-assign-support-ticket.dto";
import { AdminClassifySupportTicketDto } from "./dto/admin-classify-support-ticket.dto";
import { AdminCreateSupportTicketDto } from "./dto/admin-create-support-ticket.dto";
import { AdminEscalateSupportTicketDto } from "./dto/admin-escalate-support-ticket.dto";
import { AdminListSupportTicketsQueryDto } from "./dto/admin-list-support-tickets-query.dto";
import { AdminReopenSupportTicketDto } from "./dto/admin-reopen-support-ticket.dto";
import { AdminResolveSupportTicketDto } from "./dto/admin-resolve-support-ticket.dto";
import { AdminRespondSupportTicketDto } from "./dto/admin-respond-support-ticket.dto";
import { AdminUpdateSupportEscalationDto } from "./dto/admin-update-support-escalation.dto";
import { AdminUpdateSupportTicketDto } from "./dto/admin-update-support-ticket.dto";
import { AdminUpdateSupportTicketPriorityDto } from "./dto/admin-update-support-ticket-priority.dto";
import { AdminUpdateSupportTicketStatusDto } from "./dto/admin-update-support-ticket-status.dto";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const EXPORT_LIMIT = 10_000;
const PAUSED_STATUSES = ["waiting_for_customer", "resolved", "closed"];
const ACTIVE_ESCALATION_STATUSES: Array<SupportTicketEscalation["status"]> = ["open", "accepted"];

const STATUS_TRANSITIONS = SUPPORT_STATUS_TRANSITIONS;

function applyDefaultSla(ticket: ContactSubmission, reset = false) {
  const startedAt = reset ? new Date() : ticket.createdAt ? new Date(ticket.createdAt) : new Date();
  if (reset || !ticket.firstResponseDueAt) ticket.firstResponseDueAt = new Date(startedAt.getTime() + 4 * 60 * 60 * 1000);
  if (reset || !ticket.resolutionDueAt) ticket.resolutionDueAt = new Date(startedAt.getTime() + 48 * 60 * 60 * 1000);
  if (reset) ticket.firstRespondedAt = null;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

@Injectable()
export class AdminSupportService {
  constructor(
    @InjectRepository(ContactSubmission) private readonly ticketRepository: Repository<ContactSubmission>,
    @InjectRepository(SupportTicketNote) private readonly noteRepository: Repository<SupportTicketNote>,
    @InjectRepository(SupportTicketResponse) private readonly responseRepository: Repository<SupportTicketResponse>,
    @InjectRepository(SupportTicketEscalation) private readonly escalationRepository: Repository<SupportTicketEscalation>,
    @InjectRepository(SupportTicketResolution) private readonly resolutionRepository: Repository<SupportTicketResolution>,
    @InjectRepository(AdminUser) private readonly adminUserRepository: Repository<AdminUser>,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(Repit) private readonly repitRepository: Repository<Repit>,
    @InjectRepository(NotificationCampaign) private readonly notificationRepository: Repository<NotificationCampaign>,
    @InjectRepository(AdminAuditLog) private readonly auditLogRepository: Repository<AdminAuditLog>,
    @InjectRepository(RepitModerationReport) private readonly moderationReportRepository: Repository<RepitModerationReport>,
    @InjectRepository(RepitModerationDecision) private readonly moderationDecisionRepository: Repository<RepitModerationDecision>,
    @InjectRepository(UserRestriction) private readonly restrictionRepository: Repository<UserRestriction>,
    @InjectRepository(UserRecoveryOperation) private readonly recoveryRepository: Repository<UserRecoveryOperation>,
    private readonly dataSource: DataSource,
    private readonly auditLogsService: AdminAuditLogsService,
    private readonly mailService: MailService,
  ) {}

  async listTickets(query: AdminListSupportTicketsQueryDto, actor?: AdminRequestActor | null) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(query.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const { start: dateFrom, endExclusive: dateToExclusive } = resolveDateRange(query.dateFrom, query.dateTo, "support");

    const canReadPii = this.hasPermission(actor, "users.read_pii");
    const countQb = this.applyFilters(this.ticketRepository.createQueryBuilder("ticket"), query, dateFrom, dateToExclusive, canReadPii);
    const total = await countQb.getCount();
    const qb = this.applyFilters(this.ticketRepository.createQueryBuilder("ticket"), query, dateFrom, dateToExclusive, canReadPii);
    this.applySorting(qb, query.sortBy, query.sortOrder);
    const tickets = await qb.offset((page - 1) * pageSize).limit(pageSize).getMany();
    const activeEscalations = tickets.length
      ? await this.escalationRepository.find({ where: { ticketId: In(tickets.map((ticket) => ticket.id)), status: In(ACTIVE_ESCALATION_STATUSES) } })
      : [];
    const escalatedTicketIds = new Set(activeEscalations.map((record) => record.ticketId));

    return {
      total,
      page,
      pageSize,
      records: tickets.map((ticket) => this.serializeListItem(ticket, canReadPii, escalatedTicketIds.has(ticket.id))),
    };
  }

  async getTicketDetail(ticketId: string, actor?: AdminRequestActor | null) {
    const ticket = await this.requireTicket(ticketId);
    const canReadPii = this.hasPermission(actor, "users.read_pii");
    const canReadSensitive = this.hasPermission(actor, "support.sensitive_context.read");
    const canReadNotes = canReadSensitive || this.hasPermission(actor, "support.cases.notes");
    const [notes, responses, escalations, resolutions, relatedUser, auditLogs, relatedRepits, relatedNotifications, moderationReport] = await Promise.all([
      canReadNotes ? this.noteRepository.find({ where: { ticketId }, order: { createdAt: "DESC" } }) : Promise.resolve([]),
      this.responseRepository.find({ where: { ticketId }, order: { createdAt: "DESC" } }),
      this.escalationRepository.find({ where: { ticketId }, order: { createdAt: "DESC" } }),
      this.resolutionRepository.find({ where: { ticketId }, order: { createdAt: "DESC" } }),
      ticket.relatedUserId && canReadSensitive ? this.userRepository.findOne({ where: { id: ticket.relatedUserId } }) : Promise.resolve(null),
      this.auditLogRepository.find({ where: { targetType: "support_ticket", targetId: ticket.id }, order: { createdAt: "DESC" }, take: 100 }),
      ticket.relatedRepitIds.length && canReadSensitive
        ? this.repitRepository.find({ where: { id: In(ticket.relatedRepitIds) }, relations: { template: true } })
        : Promise.resolve([]),
      ticket.relatedNotificationIds.length && canReadSensitive
        ? this.notificationRepository.find({ where: { id: In(ticket.relatedNotificationIds) } })
        : Promise.resolve([]),
      ticket.relatedModerationReportId && canReadSensitive
        ? this.moderationReportRepository.findOne({ where: { id: ticket.relatedModerationReportId } })
        : Promise.resolve(null),
    ]);
    const [restrictions, recoveries, moderationDecision, relatedCases] = await Promise.all([
      relatedUser ? this.restrictionRepository.find({ where: { userId: relatedUser.id }, order: { createdAt: "DESC" }, take: 20 }) : Promise.resolve([]),
      relatedUser ? this.recoveryRepository.find({ where: { userId: relatedUser.id }, order: { createdAt: "DESC" }, take: 20 }) : Promise.resolve([]),
      moderationReport ? this.moderationDecisionRepository.findOne({ where: { reportId: moderationReport.id }, order: { createdAt: "DESC" } }) : Promise.resolve(null),
      ticket.relatedUserId && canReadSensitive
        ? this.ticketRepository.createQueryBuilder("related").where('related."relatedUserId" = :userId', { userId: ticket.relatedUserId }).andWhere("related.id != :ticketId", { ticketId }).orderBy('related."updatedAt"', "DESC").limit(10).getMany()
        : Promise.resolve([]),
    ]);

    const timeline = [
      { id: `case-${ticket.id}`, type: "case_created", occurredAt: ticket.createdAt.toISOString(), label: "Case created", detail: ticket.source },
      ...notes.map((note) => ({ id: `note-${note.id}`, type: "internal_note", occurredAt: note.createdAt.toISOString(), label: "Internal note added", detail: note.authorAdminEmail ? `By ${note.authorAdminEmail}` : "Internal note created" })),
      ...responses.map((response) => ({ id: `response-${response.id}`, type: "support_response", occurredAt: response.createdAt.toISOString(), label: this.responseTimelineLabel(response), detail: response.status })),
      ...escalations.map((escalation) => ({ id: `escalation-${escalation.id}`, type: "escalation", occurredAt: escalation.createdAt.toISOString(), label: `Escalation ${escalation.status}`, detail: escalation.destination })),
      ...resolutions.map((resolution) => ({ id: `resolution-${resolution.id}`, type: resolution.action, occurredAt: resolution.createdAt.toISOString(), label: resolution.action === "resolved" ? "Case resolved" : "Case reopened", detail: resolution.category ?? null })),
      ...auditLogs.map((log) => ({ id: `audit-${log.id}`, type: "audit", occurredAt: log.createdAt.toISOString(), label: log.action, detail: log.actorEmail ? `By ${log.actorEmail}` : "Admin action recorded" })),
    ].sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime());

    return {
      id: ticket.id,
      reference: `SUP-${ticket.id.slice(0, 8).toUpperCase()}`,
      subject: ticket.subject,
      description: ticket.message,
      source: { type: ticket.source, referenceType: ticket.sourceReferenceType ?? null, referenceId: ticket.sourceReferenceId ?? null },
      user: {
        id: relatedUser?.id ?? ticket.relatedUserId ?? null,
        fullName: relatedUser?.fullName ?? ticket.name,
        email: canReadPii ? relatedUser?.email ?? ticket.email : null,
        emailRedacted: !canReadPii,
      },
      assignedAdmin: ticket.assignedAdminEmail ? { id: ticket.assignedAdminUserId ?? null, email: ticket.assignedAdminEmail } : null,
      priority: ticket.priority,
      classification: { category: ticket.category ?? null, subcategory: ticket.subcategory ?? null, issueType: ticket.issueType ?? null, productArea: ticket.productArea ?? null, tags: ticket.tags },
      status: ticket.status,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
      sla: this.deriveSla(ticket),
      conversation: [
        { id: `customer-${ticket.id}`, kind: "user_message", body: ticket.message, author: ticket.name, status: "received", createdAt: ticket.createdAt },
        ...responses.map((response) => ({ id: response.id, kind: "support_response", body: response.body, author: response.authorAdminEmail ?? "Support", status: response.status, createdAt: response.createdAt })),
      ].sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()),
      internalNotes: notes.map((note) => ({ id: note.id, body: note.body, authorEmail: note.authorAdminEmail ?? null, createdAt: note.createdAt })),
      escalations: escalations.map((escalation) => ({ ...escalation })),
      resolutionHistory: resolutions.map((resolution) => ({ ...resolution })),
      timeline,
      userContext: relatedUser
        ? {
            accountStatus: relatedUser.isSuspended ? "suspended" : "active",
            emailVerified: relatedUser.emailVerified,
            lastLoginAt: relatedUser.lastLoginAt ?? null,
            activeRestrictions: restrictions.filter((restriction) => restriction.status === "active").map((restriction) => ({ id: restriction.id, type: restriction.type, policyCategory: restriction.policyCategory ?? null, startsAt: restriction.startsAt })),
            recentRecoveryActions: recoveries.map((recovery) => ({ id: recovery.id, type: recovery.type, status: recovery.status, createdAt: recovery.createdAt })),
            relatedCases: relatedCases.map((related) => ({ id: related.id, subject: related.subject, status: related.status, updatedAt: related.updatedAt })),
          }
        : null,
      relatedRepits: relatedRepits.map((repit) => ({ id: repit.id, title: repit.title, artist: repit.artist ?? null, status: repit.status, moderationStatus: repit.moderationStatus, templateId: repit.templateId })),
      moderationContext: moderationReport
        ? {
            report: { id: moderationReport.id, reportType: moderationReport.reportType, priority: moderationReport.priority, status: moderationReport.status, reason: moderationReport.reason },
            decision: moderationDecision ? { id: moderationDecision.id, action: moderationDecision.action, policyKey: moderationDecision.policyKey, policyVersion: moderationDecision.policyVersion, resultingStatus: moderationDecision.resultingStatus } : null,
          }
        : null,
      relatedNotifications: relatedNotifications.map((notification) => ({ id: notification.id, title: notification.title, status: notification.status, type: notification.type })),
      relatedAuditLogs: auditLogs.map((log) => ({ id: log.id, action: log.action, actorEmail: log.actorEmail ?? null, createdAt: log.createdAt, requestId: log.requestId ?? null })),
    };
  }

  async listEligibleReviewers() {
    const admins = await this.adminUserRepository.find({ where: { status: "active" }, relations: { roles: { permissions: true } }, order: { fullName: "ASC" } });
    return admins.filter((admin) => this.adminCan(admin, "support.cases.assign")).map((admin) => ({ id: admin.id, fullName: admin.fullName, email: admin.email }));
  }

  async createTicket(dto: AdminCreateSupportTicketDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    // Business state and its audit event commit together: an audit failure rolls
    // back the created case.
    const saved = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(ContactSubmission);
      const entity = repository.create({
        name: dto.name.trim(), email: dto.email.toLowerCase(), subject: dto.subject.trim(), message: dto.message.trim(),
        priority: dto.priority ?? "medium", category: dto.category ?? null, tags: dto.tags ?? [], relatedUserId: dto.relatedUserId ?? null,
        relatedRepitIds: dto.relatedRepitIds ?? [], relatedNotificationIds: [], status: "new", source: "admin",
      });
      applyDefaultSla(entity);
      const persisted = await repository.save(entity);
      await this.auditLogsService.append({ action: "admin.support.case_created", actor, context, targetType: "support_ticket", targetId: persisted.id, afterState: this.buildAuditSnapshot(persisted) }, manager);
      return persisted;
    });
    return this.getTicketDetail(saved.id, actor);
  }

  async updateTicket(ticketId: string, dto: AdminUpdateSupportTicketDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(ContactSubmission);
      const ticket = await repository.findOne({ where: { id: ticketId }, lock: { mode: "pessimistic_write" } });
      if (!ticket) throw new NotFoundException("Support ticket not found");
      this.normalizeTicketArrays(ticket);
      const beforeState = this.buildAuditSnapshot(ticket);
      if (dto.subject !== undefined) ticket.subject = dto.subject.trim();
      if (dto.message !== undefined) ticket.message = dto.message.trim();
      if (dto.category !== undefined) ticket.category = dto.category;
      if (dto.subcategory !== undefined) ticket.subcategory = dto.subcategory;
      if (dto.issueType !== undefined) ticket.issueType = dto.issueType;
      if (dto.productArea !== undefined) ticket.productArea = dto.productArea;
      if (dto.tags !== undefined) ticket.tags = [...new Set(dto.tags.map((tag) => tag.trim()).filter(Boolean))];
      if (dto.relatedUserId !== undefined) ticket.relatedUserId = dto.relatedUserId;
      if (dto.relatedRepitIds !== undefined) ticket.relatedRepitIds = dto.relatedRepitIds;
      if (dto.relatedNotificationIds !== undefined) ticket.relatedNotificationIds = dto.relatedNotificationIds;
      const saved = await repository.save(ticket);
      await this.auditLogsService.append({ action: "admin.support.case_updated", actor, context, targetType: "support_ticket", targetId: saved.id, beforeState, afterState: this.buildAuditSnapshot(saved) }, manager);
    });
    return this.getTicketDetail(ticketId, actor);
  }

  async classifyTicket(ticketId: string, dto: AdminClassifySupportTicketDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(ContactSubmission);
      const ticket = await repository.findOne({ where: { id: ticketId }, lock: { mode: "pessimistic_write" } });
      if (!ticket) throw new NotFoundException("Support ticket not found");
      this.normalizeTicketArrays(ticket);
      const beforeState = this.buildAuditSnapshot(ticket);
      ticket.category = dto.category;
      ticket.subcategory = dto.subcategory?.trim() || null;
      ticket.issueType = dto.issueType?.trim() || null;
      ticket.productArea = dto.productArea?.trim() || null;
      ticket.tags = [...new Set((dto.tags ?? []).map((tag) => tag.trim()).filter(Boolean))];
      const saved = await repository.save(ticket);
      await this.auditLogsService.append({ action: "admin.support.classification_changed", actor, context, targetType: "support_ticket", targetId: ticket.id, beforeState, afterState: this.buildAuditSnapshot(saved) }, manager);
    });
    return this.getTicketDetail(ticketId, actor);
  }

  async assignTicket(ticketId: string, dto: AdminAssignSupportTicketDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    if (!actor) throw new BadRequestException("Authenticated administrator required");
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(ContactSubmission);
      const ticket = await repository.findOne({ where: { id: ticketId }, lock: { mode: "pessimistic_write" } });
      if (!ticket) throw new NotFoundException("Support ticket not found");
      if (["resolved", "closed"].includes(ticket.status)) throw new ConflictException("Resolved or closed cases cannot be assigned");
      const beforeState = this.buildAuditSnapshot(ticket);
      if (dto.action === "release") {
        ticket.assignedAdminUserId = null;
        ticket.assignedAdminEmail = null;
        if (ticket.status === "assigned") ticket.status = "open";
      } else {
        const assignee = dto.action === "claim" ? await manager.getRepository(AdminUser).findOne({ where: { id: actor.id }, relations: { roles: { permissions: true } } }) : await manager.getRepository(AdminUser).findOne({ where: { id: dto.adminUserId }, relations: { roles: { permissions: true } } });
        if (!assignee || assignee.status !== "active" || !this.adminCan(assignee, "support.cases.assign")) throw new BadRequestException("Selected administrator is not eligible for support assignment");
        if (dto.action === "claim" && ticket.assignedAdminUserId && ticket.assignedAdminUserId !== actor.id) throw new ConflictException("This case is already assigned to another administrator");
        ticket.assignedAdminUserId = assignee.id;
        ticket.assignedAdminEmail = assignee.email;
        if (ticket.status !== "escalated") ticket.status = "assigned";
      }
      const saved = await repository.save(ticket);
      const actionName = dto.action === "assign" ? "assigned" : dto.action === "claim" ? "claimed" : "released";
      await this.auditLogsService.append({ action: `admin.support.case_${actionName}`, actor, context, targetType: "support_ticket", targetId: ticket.id, beforeState, afterState: this.buildAuditSnapshot(saved), metadata: { reason: dto.reason?.trim() ?? null, assignedAdminUserId: saved.assignedAdminUserId ?? null } }, manager);
    });
    return this.getTicketDetail(ticketId, actor);
  }

  async updateStatus(ticketId: string, dto: AdminUpdateSupportTicketStatusDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(ContactSubmission);
      const ticket = await repository.findOne({ where: { id: ticketId }, lock: { mode: "pessimistic_write" } });
      if (!ticket) throw new NotFoundException("Support ticket not found");
      if (!(STATUS_TRANSITIONS[ticket.status] ?? []).includes(dto.status)) throw new ConflictException(`Cannot move a ${ticket.status} case to ${dto.status}`);
      if (dto.status !== "escalated" && ticket.status === "escalated") {
        const activeEscalations = await manager.getRepository(SupportTicketEscalation).count({ where: { ticketId, status: In(ACTIVE_ESCALATION_STATUSES) } });
        if (activeEscalations) throw new ConflictException("Resolve or return active escalations before changing this case status");
      }
      if (dto.status === "closed") {
        const queuedResponses = await manager.getRepository(SupportTicketResponse).count({ where: { ticketId, status: "queued" } });
        if (queuedResponses) throw new ConflictException("Wait for the in-progress response to finish before closing this case");
      }
      const beforeState = this.buildAuditSnapshot(ticket);
      ticket.status = dto.status;
      if (dto.status === "closed") ticket.closedAt = new Date();
      const saved = await repository.save(ticket);
      await this.auditLogsService.append({ action: "admin.support.status_changed", actor, context, targetType: "support_ticket", targetId: ticket.id, beforeState, afterState: this.buildAuditSnapshot(saved), metadata: { reason: dto.reason?.trim() ?? null } }, manager);
    });
    return this.getTicketDetail(ticketId, actor);
  }

  async updatePriority(ticketId: string, dto: AdminUpdateSupportTicketPriorityDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(ContactSubmission);
      const ticket = await repository.findOne({ where: { id: ticketId }, lock: { mode: "pessimistic_write" } });
      if (!ticket) throw new NotFoundException("Support ticket not found");
      this.normalizeTicketArrays(ticket);
      const beforeState = this.buildAuditSnapshot(ticket);
      ticket.priority = dto.priority;
      const saved = await repository.save(ticket);
      await this.auditLogsService.append({ action: "admin.support.priority_changed", actor, context, targetType: "support_ticket", targetId: ticket.id, beforeState, afterState: this.buildAuditSnapshot(saved), metadata: { reason: dto.reason?.trim() ?? null } }, manager);
    });
    return this.getTicketDetail(ticketId, actor);
  }

  async addNote(ticketId: string, dto: AdminAddSupportTicketNoteDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    await this.dataSource.transaction(async (manager) => {
      // Lock the parent case first (canonical order) so the note + its audit event
      // commit atomically against a stable case row.
      const ticketRepository = manager.getRepository(ContactSubmission);
      const ticket = await ticketRepository.findOne({ where: { id: ticketId }, lock: { mode: "pessimistic_write" } });
      if (!ticket) throw new NotFoundException("Support ticket not found");
      const noteRepository = manager.getRepository(SupportTicketNote);
      const saved = await noteRepository.save(noteRepository.create({ ticketId, body: dto.body.trim(), authorAdminUserId: actor?.id ?? null, authorAdminEmail: actor?.email ?? null }));
      await this.auditLogsService.append({ action: "admin.support.internal_note_added", actor, context, targetType: "support_ticket", targetId: ticketId, metadata: { noteId: saved.id } }, manager);
    });
    return this.getTicketDetail(ticketId, actor);
  }

  async respond(ticketId: string, dto: AdminRespondSupportTicketDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    // ── State-aware idempotency ────────────────────────────────────────────
    // An existing key is handled by the PERSISTED state of its attempt, never as
    // a blanket success.
    const existing = await this.responseRepository.findOne({ where: { idempotencyKey: dto.idempotencyKey } });
    if (existing) {
      if (existing.ticketId !== ticketId) {
        await this.safeAudit({ action: "admin.support.response_key_conflict", actor, context, targetType: "support_ticket", targetId: ticketId, metadata: { responseId: existing.id, boundTicketId: existing.ticketId } });
        throw new ConflictException("Response idempotency key already used");
      }
      if (existing.status === "sent_to_provider") {
        // Already accepted — idempotent replay, provider is never contacted again.
        await this.safeAudit({ action: "admin.support.response_replayed", actor, context, targetType: "support_ticket", targetId: ticketId, metadata: { responseId: existing.id, deliveryState: "sent_to_provider" } });
        return this.withDelivery(ticketId, actor, this.delivery(existing, "already_accepted", false), context);
      }
      if (existing.status === "queued") {
        // In progress / uncertain — never claim success.
        await this.safeAudit({ action: "admin.support.response_concurrent_blocked", actor, context, targetType: "support_ticket", targetId: ticketId, metadata: { responseId: existing.id, state: "queued" } });
        throw this.pendingConflict(existing);
      }
      if (existing.status === "failed" && existing.failureCategory === "provider_failure") {
        // Confirmed provider rejection — retry the EXISTING attempt (no new row).
        return this.retryExistingResponse(ticketId, existing.id, dto, actor, context);
      }
      // Unknown / inconsistent — recoverable error, draft preserved by the client.
      throw new ServiceUnavailableException({ statusCode: 503, error: "ResponseStateInconsistent", deliveryOutcome: "uncertain", retryable: false, responseId: existing.id, message: "This response attempt is in an unexpected state. Refresh the case before retrying." });
    }

    // ── Defect 2: claim the attempt AND its audit event atomically, BEFORE any
    // provider contact. If the audit write fails, the queued row rolls back, so a
    // later retry cannot find an orphaned queued attempt and report false success.
    let response: SupportTicketResponse;
    let ticket: ContactSubmission;
    try {
      const claim = await this.dataSource.transaction(async (manager) => {
        const caseRepository = manager.getRepository(ContactSubmission);
        const repository = manager.getRepository(SupportTicketResponse);
        // Serialize NEW attempts for this case on the parent-case row so that
        // multi-tab / refreshed / different-key submissions cannot each create a
        // queued row and contact the provider. Any existing UNRESOLVED (queued)
        // attempt must be reconciled before a fresh key is accepted.
        const lockedCase = await caseRepository.findOne({ where: { id: ticketId }, lock: { mode: "pessimistic_write" } });
        if (!lockedCase) throw new NotFoundException("Support ticket not found");
        if (["resolved", "closed"].includes(lockedCase.status)) throw new ConflictException("Reopen this case before sending a response");
        this.normalizeTicketArrays(lockedCase);
        const inflight = await repository.findOne({ where: { ticketId, status: "queued" }, order: { createdAt: "DESC" } });
        if (inflight?.status === "queued") {
          return { kind: "blocked" as const, response: inflight, ticket: lockedCase };
        }
        const created = await repository.save(repository.create({ ticketId, body: dto.body.trim(), authorAdminUserId: actor?.id ?? null, authorAdminEmail: actor?.email ?? null, idempotencyKey: dto.idempotencyKey, status: "queued", lastAttemptAt: new Date() }));
        await this.auditLogsService.append({ action: "admin.support.response_attempted", actor, context, targetType: "support_ticket", targetId: ticketId, metadata: { responseId: created.id, idempotencyReference: this.idempotencyReference(dto.idempotencyKey), resultingState: "queued" } }, manager);
        return { kind: "claimed" as const, response: created, ticket: lockedCase };
      });
      if (claim.kind === "blocked") {
        await this.safeAudit({ action: "admin.support.response_concurrent_blocked", actor, context, targetType: "support_ticket", targetId: ticketId, metadata: { responseId: claim.response.id, state: "queued", reason: "existing_inflight_attempt" } });
        throw this.pendingConflict(claim.response);
      }
      response = claim.response;
      ticket = claim.ticket;
    } catch (error) {
      if (error instanceof ConflictException || error instanceof NotFoundException) throw error;
      // A concurrent submission won a unique index — either the idempotency-key
      // index (same key) or the single-inflight-per-case index (different key).
      if ((error as { code?: string }).code === "23505") {
        const duplicate = await this.responseRepository.findOne({ where: { idempotencyKey: dto.idempotencyKey } });
        if (duplicate) {
          if (duplicate.ticketId !== ticketId) throw new ConflictException("Response idempotency key already used");
          if (duplicate.status === "sent_to_provider") return this.withDelivery(ticketId, actor, this.delivery(duplicate, "already_accepted", false), context);
          await this.safeAudit({ action: "admin.support.response_concurrent_blocked", actor, context, targetType: "support_ticket", targetId: ticketId, metadata: { responseId: duplicate.id, state: duplicate.status } });
          throw this.pendingConflict(duplicate);
        }
        const inflight = await this.responseRepository.findOne({ where: { ticketId, status: "queued" }, order: { createdAt: "DESC" } });
        if (inflight?.status === "queued") {
          await this.safeAudit({ action: "admin.support.response_concurrent_blocked", actor, context, targetType: "support_ticket", targetId: ticketId, metadata: { responseId: inflight.id, state: "queued", reason: "existing_inflight_attempt" } });
          throw this.pendingConflict(inflight);
        }
      }
      throw error;
    }

    return this.deliverResponse(ticketId, ticket, response, dto, actor, context, "initial");
  }

  /** Retry a confirmed provider rejection: claim the SAME row under a lock and
   *  call the provider exactly once. Concurrent retries cannot both send. */
  private async retryExistingResponse(ticketId: string, responseId: string, dto: AdminRespondSupportTicketDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    const outcome: { kind: "claimed" | "already_accepted" | "in_progress" | "blocked_by_other"; row: SupportTicketResponse | null; ticket: ContactSubmission | null } = { kind: "in_progress", row: null, ticket: null };
    await this.dataSource.transaction(async (manager) => {
      const caseRepository = manager.getRepository(ContactSubmission);
      const repository = manager.getRepository(SupportTicketResponse);
      // Canonical order for every response claim: parent case, then response.
      // This serializes retries with fresh-key sends as well as with other retries.
      const lockedCase = await caseRepository.findOne({ where: { id: ticketId }, lock: { mode: "pessimistic_write" } });
      if (!lockedCase) throw new NotFoundException("Support ticket not found");
      if (["resolved", "closed"].includes(lockedCase.status)) throw new ConflictException("Reopen this case before sending a response");
      this.normalizeTicketArrays(lockedCase);
      outcome.ticket = lockedCase;
      const row = await repository.findOne({ where: { id: responseId }, lock: { mode: "pessimistic_write" } });
      if (!row || row.ticketId !== ticketId) throw new NotFoundException("Response attempt not found");
      outcome.row = row;
      if (row.status === "sent_to_provider") { outcome.kind = "already_accepted"; return; }
      if (row.status === "queued") { outcome.kind = "in_progress"; return; }
      if (row.status !== "failed") throw new ServiceUnavailableException({ statusCode: 503, error: "ResponseStateInconsistent", deliveryOutcome: "uncertain", retryable: false, responseId, message: "This response attempt cannot be retried in its current state. Refresh the case." });
      const inflight = await repository.findOne({ where: { ticketId, status: "queued" }, order: { createdAt: "DESC" } });
      if (inflight?.status === "queued") {
        outcome.kind = "blocked_by_other";
        outcome.row = inflight;
        return;
      }
      row.status = "queued";
      row.failureCategory = null;
      row.lastAttemptAt = new Date(); // fresh claim time so the active retry is not treated as stale
      await repository.save(row);
      await this.auditLogsService.append({ action: "admin.support.response_retry_started", actor, context, targetType: "support_ticket", targetId: ticketId, metadata: { responseId, previousState: "failed", resultingState: "queued" } }, manager);
      outcome.kind = "claimed";
    });

    if (outcome.kind === "already_accepted" && outcome.row) {
      await this.safeAudit({ action: "admin.support.response_replayed", actor, context, targetType: "support_ticket", targetId: ticketId, metadata: { responseId, deliveryState: "sent_to_provider" } });
      return this.withDelivery(ticketId, actor, this.delivery(outcome.row, "already_accepted", false), context);
    }
    if (outcome.kind === "in_progress" && outcome.row) {
      await this.safeAudit({ action: "admin.support.response_concurrent_blocked", actor, context, targetType: "support_ticket", targetId: ticketId, metadata: { responseId, state: "queued" } });
      throw this.pendingConflict(outcome.row);
    }
    if (outcome.kind === "blocked_by_other" && outcome.row) {
      await this.safeAudit({ action: "admin.support.response_concurrent_blocked", actor, context, targetType: "support_ticket", targetId: ticketId, metadata: { responseId: outcome.row.id, state: "queued", reason: "existing_inflight_attempt" } });
      throw this.pendingConflict(outcome.row);
    }
    return this.deliverResponse(ticketId, outcome.ticket as ContactSubmission, outcome.row as SupportTicketResponse, dto, actor, context, "retry");
  }

  /** Call the provider exactly once for a claimed (queued) attempt and persist the
   *  truthful outcome. Provider rejection is the only provider_failure. */
  private async deliverResponse(ticketId: string, ticket: ContactSubmission, response: SupportTicketResponse, dto: AdminRespondSupportTicketDto, actor: AdminRequestActor | null | undefined, context: AdminRequestContext | null | undefined, mode: "initial" | "retry") {
    // STEP 1 — provider outcome only.
    try {
      await this.mailService.sendRaw({ to: ticket.email, subject: `Re: ${ticket.subject}`, html: `<div style="font-family: sans-serif; line-height: 1.6">${escapeHtml(dto.body.trim()).replace(/\n/g, "<br />")}</div>`, sensitive: true });
    } catch {
      response.status = "failed";
      response.failureCategory = "provider_failure";
      await this.responseRepository.save(response);
      await this.safeAudit({ action: mode === "retry" ? "admin.support.response_retry_rejected" : "admin.support.response_failed", actor, context, targetType: "support_ticket", targetId: ticketId, metadata: { responseId: response.id, failureCategory: "provider_failure", previousState: "queued", resultingState: "failed" } });
      throw new ServiceUnavailableException({ statusCode: 503, error: "ProviderRejected", deliveryOutcome: "rejected", retryable: true, responseId: response.id, message: "The email provider rejected the response. Nothing was delivered — you can retry." });
    }

    // Provider ACCEPTED — record acceptance immediately, before bookkeeping.
    response.status = "sent_to_provider";
    response.sentAt = new Date();
    try {
      await this.responseRepository.save(response);
    } catch {
      await this.safeAudit({ action: "admin.support.response_delivery_unrecorded", actor, context, targetType: "support_ticket", targetId: ticketId, metadata: { responseId: response.id, deliveryState: "sent_to_provider", persistence: "failed" } });
      throw new ServiceUnavailableException({ statusCode: 503, error: "DeliveryUncertain", deliveryOutcome: "uncertain", retryable: false, responseId: response.id, message: "Accepted by the email provider but the outcome could not be recorded. Do not resend; refresh the case to confirm state." });
    }

    // STEP 2 — case bookkeeping + audit. A failure here is NOT a provider failure;
    // the row already truthfully reads sent_to_provider.
    try {
      await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(ContactSubmission);
        const currentTicket = await repository.findOne({ where: { id: ticketId }, lock: { mode: "pessimistic_write" } });
        if (!currentTicket) throw new NotFoundException("Support ticket not found");
        const statusAtClaim = ticket.status;
        const statusChangedSinceClaim = currentTicket.status !== statusAtClaim;
        currentTicket.lastAdminReplyAt = response.sentAt;
        currentTicket.firstRespondedAt ??= response.sentAt;
        if (!statusChangedSinceClaim && !["resolved", "closed"].includes(currentTicket.status)) currentTicket.status = "waiting_for_customer";
        await repository.save(currentTicket);
        await this.auditLogsService.append({ action: mode === "retry" ? "admin.support.response_retry_accepted" : "admin.support.response_sent", actor, context, targetType: "support_ticket", targetId: ticketId, metadata: { responseId: response.id, deliveryState: "sent_to_provider", previousState: "queued", resultingState: "sent_to_provider", caseStatusAtClaim: statusAtClaim, caseStatusAfterBookkeeping: currentTicket.status, caseStatusPreserved: statusChangedSinceClaim } }, manager);
      });
    } catch {
      await this.safeAudit({ action: "admin.support.response_post_persist_failed", actor, context, targetType: "support_ticket", targetId: ticketId, metadata: { responseId: response.id, deliveryState: "sent_to_provider" } });
      throw new ServiceUnavailableException({ statusCode: 503, error: "DeliveryUncertain", deliveryOutcome: "uncertain", retryable: false, responseId: response.id, message: "Sent to the email provider, but updating the case afterwards failed. Do not resend; refresh the case." });
    }
    return this.withDelivery(ticketId, actor, this.delivery(response, "accepted", false), context);
  }

  private delivery(response: SupportTicketResponse, outcome: "accepted" | "already_accepted", retryable: boolean) {
    return { responseId: response.id, status: response.status, outcome, retryable };
  }

  private pendingConflict(response: SupportTicketResponse) {
    return new ConflictException({ statusCode: 409, error: "ResponseInProgress", deliveryOutcome: "in_progress", retryable: false, responseId: response.id, message: "A response for this attempt is still processing. Refresh the case before retrying." });
  }

  private idempotencyReference(key: string) {
    return createHash("sha256").update(key).digest("hex").slice(0, 16);
  }

  /**
   * Return the confirmed delivery outcome WITH the refreshed case, but never let a
   * case-detail hydration failure erase a truthful provider acceptance: on
   * hydration failure the typed outcome is still returned (caseDetail omitted) so
   * the client can show acceptance and refetch the case separately.
   */
  private async withDelivery(ticketId: string, actor: AdminRequestActor | null | undefined, responseDelivery: ReturnType<AdminSupportService["delivery"]>, context?: AdminRequestContext | null) {
    try {
      const caseDetail = await this.getTicketDetail(ticketId, actor);
      return { responseDelivery, caseDetail };
    } catch {
      await this.safeAudit({ action: "admin.support.response_detail_hydration_failed", actor, context, targetType: "support_ticket", targetId: ticketId, metadata: { responseId: responseDelivery.responseId, deliveryState: responseDelivery.status } });
      return { responseDelivery };
    }
  }

  /** How long a queued attempt may sit before we treat it as uncertain rather than
   *  claiming it is still actively in progress. Evaluated on the SERVER clock. */
  private static readonly STALE_QUEUED_MS = 15 * 60 * 1000;

  /**
   * Authoritative reconciliation of a single response attempt. Reads persisted
   * state only — the provider is never contacted. Cross-case access is rejected as
   * not-found; permission is enforced at the controller.
   */
  async getResponseAttemptStatus(ticketId: string, responseId: string, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    const row = await this.responseRepository.findOne({ where: { id: responseId } });
    if (!row || row.ticketId !== ticketId) throw new NotFoundException("Response attempt not found");
    await this.safeAudit({ action: "admin.support.response_reconciliation_requested", actor, context, targetType: "support_ticket", targetId: ticketId, metadata: { responseId } });

    let deliveryOutcome: "accepted" | "already_accepted" | "rejected" | "in_progress" | "uncertain";
    let retryable = false;
    let sendAllowed = false;
    if (row.status === "sent_to_provider") {
      deliveryOutcome = "already_accepted";
    } else if (row.status === "failed" && row.failureCategory === "provider_failure") {
      deliveryOutcome = "rejected"; retryable = true; sendAllowed = true;
    } else if (row.status === "queued") {
      // Measure staleness from the latest CLAIM time (create or retry), never the
      // immutable createdAt, so an active retry of an old attempt is not instantly
      // classified as stale. A stale queued attempt is uncertain (provider may or
      // may not have been reached) but is never reported accepted/rejected, and
      // sending stays blocked.
      const claimAt = row.lastAttemptAt ?? row.createdAt;
      const ageMs = Date.now() - new Date(claimAt).getTime();
      deliveryOutcome = ageMs > AdminSupportService.STALE_QUEUED_MS ? "uncertain" : "in_progress";
    } else {
      deliveryOutcome = "uncertain";
    }

    const result = {
      responseId: row.id,
      idempotencyReference: this.idempotencyReference(row.idempotencyKey),
      status: row.status,
      deliveryOutcome,
      retryable,
      sendAllowed,
    };
    await this.safeAudit({ action: "admin.support.response_reconciliation_result", actor, context, targetType: "support_ticket", targetId: ticketId, metadata: { responseId, status: row.status, deliveryOutcome, sendAllowed } });
    return result;
  }

  /** Best-effort audit that never masks the primary outcome. */
  private async safeAudit(input: Parameters<AdminAuditLogsService["append"]>[0]) {
    await this.auditLogsService.append(input).catch(() => undefined);
  }

  async escalate(ticketId: string, dto: AdminEscalateSupportTicketDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    await this.dataSource.transaction(async (manager) => {
      const ticket = await manager.getRepository(ContactSubmission).findOne({ where: { id: ticketId }, lock: { mode: "pessimistic_write" } });
      if (!ticket) throw new NotFoundException("Support ticket not found");
      if (["resolved", "closed"].includes(ticket.status)) throw new ConflictException("Resolved or closed cases cannot be escalated");
      const escalation = await manager.getRepository(SupportTicketEscalation).save(manager.getRepository(SupportTicketEscalation).create({ ticketId, destination: dto.destination as SupportTicketEscalation["destination"], severity: dto.severity as SupportTicketEscalation["severity"], reason: dto.reason.trim(), requestedAction: dto.requestedAction.trim(), status: "open", createdByAdminUserId: actor?.id ?? null, createdByAdminEmail: actor?.email ?? null }));
      const beforeState = this.buildAuditSnapshot(ticket);
      ticket.status = "escalated";
      await manager.getRepository(ContactSubmission).save(ticket);
      await this.auditLogsService.append({ action: "admin.support.escalation_created", actor, context, targetType: "support_ticket", targetId: ticketId, beforeState, afterState: this.buildAuditSnapshot(ticket), metadata: { escalationId: escalation.id, destination: escalation.destination, severity: escalation.severity } }, manager);
    });
    return this.getTicketDetail(ticketId, actor);
  }

  async updateEscalation(ticketId: string, escalationId: string, dto: AdminUpdateSupportEscalationDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    await this.dataSource.transaction(async (manager) => {
      const escalation = await manager.getRepository(SupportTicketEscalation).findOne({ where: { id: escalationId, ticketId }, lock: { mode: "pessimistic_write" } });
      if (!escalation) throw new NotFoundException("Support escalation not found");
      if (["resolved", "returned"].includes(escalation.status)) throw new ConflictException("This escalation is already complete");
      const beforeState = { status: escalation.status, assignedAdminUserId: escalation.assignedAdminUserId ?? null };
      if (dto.action === "accept" || dto.action === "assign") {
        if (!actor) throw new BadRequestException("Authenticated administrator required");
        const assigneeId = dto.action === "accept" ? actor.id : dto.assigneeAdminUserId;
        const assignee = await manager.getRepository(AdminUser).findOne({ where: { id: assigneeId }, relations: { roles: { permissions: true } } });
        if (!assignee || assignee.status !== "active" || !this.adminCan(assignee, "support.cases.escalate")) throw new BadRequestException("Selected administrator is not eligible for escalation ownership");
        escalation.status = "accepted";
        escalation.assignedAdminUserId = assignee.id;
        escalation.assignedAdminEmail = assignee.email;
        escalation.acceptedAt ??= new Date();
      } else {
        escalation.status = dto.action === "resolve" ? "resolved" : "returned";
        escalation.outcome = dto.outcome?.trim() ?? null;
        escalation.resolvedAt = new Date();
      }
      await manager.getRepository(SupportTicketEscalation).save(escalation);
      if (["resolved", "returned"].includes(escalation.status)) {
        const remaining = await manager.getRepository(SupportTicketEscalation).count({ where: { ticketId, status: In(ACTIVE_ESCALATION_STATUSES) } });
        if (remaining === 0) {
          const ticket = await manager.getRepository(ContactSubmission).findOne({ where: { id: ticketId } });
          if (ticket?.status === "escalated") {
            ticket.status = ticket.assignedAdminUserId ? "assigned" : "open";
            await manager.getRepository(ContactSubmission).save(ticket);
          }
        }
      }
      const auditActionByUpdate = {
        accept: "accepted",
        assign: "assigned",
        resolve: "resolved",
        return: "returned",
      } as const;
      await this.auditLogsService.append({ action: `admin.support.escalation_${auditActionByUpdate[dto.action]}`, actor, context, targetType: "support_ticket", targetId: ticketId, beforeState, afterState: { status: escalation.status, assignedAdminUserId: escalation.assignedAdminUserId ?? null }, metadata: { escalationId, outcomeRecorded: Boolean(escalation.outcome), reason: dto.reason?.trim() ?? null } }, manager);
    });
    return this.getTicketDetail(ticketId, actor);
  }

  async resolveTicket(ticketId: string, dto: AdminResolveSupportTicketDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    await this.dataSource.transaction(async (manager) => {
      const ticket = await manager.getRepository(ContactSubmission).findOne({ where: { id: ticketId }, lock: { mode: "pessimistic_write" } });
      if (!ticket) throw new NotFoundException("Support ticket not found");
      if (["resolved", "closed"].includes(ticket.status)) throw new ConflictException("This case is already resolved");
      const queuedResponses = await manager.getRepository(SupportTicketResponse).count({ where: { ticketId, status: "queued" } });
      if (queuedResponses) throw new ConflictException("Wait for the in-progress response to finish before resolving this case");
      const activeEscalations = await manager.getRepository(SupportTicketEscalation).count({ where: { ticketId, status: In(ACTIVE_ESCALATION_STATUSES) } });
      if (activeEscalations) throw new ConflictException("Resolve or return active escalations before resolving this case");
      const beforeState = this.buildAuditSnapshot(ticket);
      ticket.status = "resolved";
      ticket.resolvedAt = new Date();
      const saved = await manager.getRepository(ContactSubmission).save(ticket);
      const resolution = await manager.getRepository(SupportTicketResolution).save(manager.getRepository(SupportTicketResolution).create({ ticketId, action: "resolved", category: dto.resolutionCategory, summary: dto.resolutionSummary.trim(), actorAdminUserId: actor?.id ?? null, actorAdminEmail: actor?.email ?? null }));
      await this.auditLogsService.append({ action: "admin.support.case_resolved", actor, context, targetType: "support_ticket", targetId: ticketId, beforeState, afterState: this.buildAuditSnapshot(saved), metadata: { resolutionId: resolution.id, category: resolution.category } }, manager);
    });
    return this.getTicketDetail(ticketId, actor);
  }

  async reopenTicket(ticketId: string, dto: AdminReopenSupportTicketDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    await this.dataSource.transaction(async (manager) => {
      const ticket = await manager.getRepository(ContactSubmission).findOne({ where: { id: ticketId }, lock: { mode: "pessimistic_write" } });
      if (!ticket) throw new NotFoundException("Support ticket not found");
      if (!["resolved", "closed"].includes(ticket.status)) throw new ConflictException("Only resolved or closed cases can be reopened");
      const beforeState = this.buildAuditSnapshot(ticket);
      ticket.status = "reopened";
      ticket.resolvedAt = null;
      ticket.closedAt = null;
      applyDefaultSla(ticket, true);
      const saved = await manager.getRepository(ContactSubmission).save(ticket);
      const resolution = await manager.getRepository(SupportTicketResolution).save(manager.getRepository(SupportTicketResolution).create({ ticketId, action: "reopened", summary: dto.reason.trim(), actorAdminUserId: actor?.id ?? null, actorAdminEmail: actor?.email ?? null }));
      await this.auditLogsService.append({ action: "admin.support.case_reopened", actor, context, targetType: "support_ticket", targetId: ticketId, beforeState, afterState: this.buildAuditSnapshot(saved), metadata: { resolutionId: resolution.id, reason: dto.reason.trim() } }, manager);
    });
    return this.getTicketDetail(ticketId, actor);
  }

  async exportTickets(query: AdminListSupportTicketsQueryDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    const { start: dateFrom, endExclusive: dateToExclusive } = resolveDateRange(query.dateFrom, query.dateTo, "support");
    const canReadPii = this.hasPermission(actor, "users.read_pii");
    const qb = this.applyFilters(this.ticketRepository.createQueryBuilder("ticket"), query, dateFrom, dateToExclusive, canReadPii);
    this.applySorting(qb, query.sortBy, query.sortOrder);
    const records = await qb.limit(EXPORT_LIMIT + 1).getMany();
    const truncated = records.length > EXPORT_LIMIT;
    const exported = records.slice(0, EXPORT_LIMIT);
    const csv = createCsv(
      ["Case reference", "Subject", "User", "Email", "Category", "Priority", "Status", "Source", "Assigned agent", "SLA state", "Created", "Last activity"],
      exported.map((ticket) => [`SUP-${ticket.id.slice(0, 8).toUpperCase()}`, ticket.subject, ticket.name, canReadPii ? ticket.email : "", ticket.category, ticket.priority, ticket.status, ticket.source, ticket.assignedAdminEmail, this.deriveSla(ticket).state, ticket.createdAt, ticket.updatedAt]),
    );
    await this.auditLogsService.append({ action: "admin.support.export_generated", actor, context, targetType: "support_export", metadata: { filters: this.safeFilterMetadata(query), resultCount: exported.length, truncated, limit: EXPORT_LIMIT } });
    return { csv, filename: `repitair-support-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`, resultCount: exported.length, truncated, limit: EXPORT_LIMIT };
  }

  private async requireTicket(ticketId: string) {
    const ticket = await this.ticketRepository.findOne({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException("Support ticket not found");
    this.normalizeTicketArrays(ticket);
    return ticket;
  }

  private normalizeTicketArrays(ticket: ContactSubmission) {
    ticket.tags = Array.isArray(ticket.tags) ? ticket.tags : [];
    ticket.relatedRepitIds = Array.isArray(ticket.relatedRepitIds) ? ticket.relatedRepitIds : [];
    ticket.relatedNotificationIds = Array.isArray(ticket.relatedNotificationIds) ? ticket.relatedNotificationIds : [];
  }

  private applyFilters(qb: SelectQueryBuilder<ContactSubmission>, query: AdminListSupportTicketsQueryDto, dateFrom: Date | null, dateToExclusive: Date | null, canReadPii: boolean) {
    const search = query.search?.trim();
    if (search) {
      const fields = ['ticket.id::text ILIKE :search', 'ticket.subject ILIKE :search', 'ticket.message ILIKE :search', 'ticket.name ILIKE :search'];
      if (canReadPii) fields.push('ticket.email ILIKE :search');
      qb.andWhere(`(${fields.join(" OR ")})`, { search: `%${search}%` });
    }
    if (query.status) qb.andWhere("ticket.status = :status", { status: query.status });
    if (query.priority) qb.andWhere("ticket.priority = :priority", { priority: query.priority });
    if (query.category) qb.andWhere("ticket.category = :category", { category: query.category });
    if (query.assignedAdminUserId) qb.andWhere('ticket."assignedAdminUserId" = :assignedAdminUserId', { assignedAdminUserId: query.assignedAdminUserId });
    if (query.assignment === "assigned") qb.andWhere('ticket."assignedAdminUserId" IS NOT NULL');
    if (query.assignment === "unassigned") qb.andWhere('ticket."assignedAdminUserId" IS NULL');
    if (query.source) qb.andWhere("ticket.source = :source", { source: query.source });
    if (query.tag) qb.andWhere(":tag = ANY(ticket.tags)", { tag: query.tag });
    if (query.escalation === "active") qb.andWhere(`EXISTS (SELECT 1 FROM support_ticket_escalations escalation WHERE escalation."ticketId" = ticket.id AND escalation.status IN ('open', 'accepted'))`);
    if (query.escalation === "none") qb.andWhere(`NOT EXISTS (SELECT 1 FROM support_ticket_escalations escalation WHERE escalation."ticketId" = ticket.id AND escalation.status IN ('open', 'accepted'))`);
    if (query.slaState) this.applySlaFilter(qb, query.slaState);
    if (dateFrom) qb.andWhere('ticket."createdAt" >= :dateFrom', { dateFrom: dateFrom.toISOString() });
    if (dateToExclusive) qb.andWhere('ticket."createdAt" < :dateToExclusive', { dateToExclusive: dateToExclusive.toISOString() });
    return qb;
  }

  private applySlaFilter(qb: SelectQueryBuilder<ContactSubmission>, state: NonNullable<AdminListSupportTicketsQueryDto["slaState"]>) {
    const now = new Date();
    const firstDueSoon = new Date(now.getTime() + 60 * 60 * 1000);
    const resolutionDueSoon = new Date(now.getTime() + 4 * 60 * 60 * 1000);
    const paused = `ticket.status IN (:...pausedStatuses)`;
    const breached = `((ticket."firstRespondedAt" IS NULL AND ticket."firstResponseDueAt" IS NOT NULL AND ticket."firstResponseDueAt" < :now) OR (ticket."resolutionDueAt" IS NOT NULL AND ticket."resolutionDueAt" < :now))`;
    const dueSoon = `((ticket."firstRespondedAt" IS NULL AND ticket."firstResponseDueAt" IS NOT NULL AND ticket."firstResponseDueAt" BETWEEN :now AND :firstDueSoon) OR (ticket."resolutionDueAt" IS NOT NULL AND ticket."resolutionDueAt" BETWEEN :now AND :resolutionDueSoon))`;
    const params = { pausedStatuses: PAUSED_STATUSES, now: now.toISOString(), firstDueSoon: firstDueSoon.toISOString(), resolutionDueSoon: resolutionDueSoon.toISOString() };
    if (state === "paused") qb.andWhere(paused, params);
    else if (state === "breached") qb.andWhere(`NOT ${paused} AND ${breached}`, params);
    else if (state === "due_soon") qb.andWhere(`NOT ${paused} AND NOT ${breached} AND ${dueSoon}`, params);
    else qb.andWhere(`NOT ${paused} AND NOT ${breached} AND NOT ${dueSoon}`, params);
  }

  private applySorting(qb: SelectQueryBuilder<ContactSubmission>, sortBy?: string, sortOrder?: string) {
    const order = sortOrder === "asc" ? "ASC" : "DESC";
    if (sortBy === "updatedAt") qb.orderBy('ticket."updatedAt"', order);
    else if (sortBy === "priority") qb.orderBy("CASE ticket.priority WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END", order);
    else if (sortBy === "status") qb.orderBy("ticket.status", order);
    else if (sortBy === "subject") qb.orderBy("ticket.subject", order);
    else if (sortBy === "sla") qb.orderBy('LEAST(COALESCE(ticket."firstResponseDueAt", ticket."resolutionDueAt"), ticket."resolutionDueAt")', order);
    else qb.orderBy('ticket."createdAt"', order);
  }

  private serializeListItem(ticket: ContactSubmission, canReadPii: boolean, hasActiveEscalation: boolean) {
    return {
      id: ticket.id,
      reference: `SUP-${ticket.id.slice(0, 8).toUpperCase()}`,
      subject: ticket.subject,
      userName: ticket.name,
      userEmail: canReadPii ? ticket.email : null,
      assignedAdminEmail: ticket.assignedAdminEmail ?? null,
      priority: ticket.priority,
      category: ticket.category ?? null,
      status: ticket.status,
      source: ticket.source,
      tags: ticket.tags,
      hasActiveEscalation,
      ageMinutes: Math.max(0, Math.floor((Date.now() - new Date(ticket.createdAt).getTime()) / 60_000)),
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
      sla: this.deriveSla(ticket),
    };
  }

  private deriveSla(ticket: ContactSubmission) {
    const now = Date.now();
    const firstDue = ticket.firstResponseDueAt ? new Date(ticket.firstResponseDueAt).getTime() : null;
    const resolutionDue = ticket.resolutionDueAt ? new Date(ticket.resolutionDueAt).getTime() : null;
    const paused = PAUSED_STATUSES.includes(ticket.status);
    const firstBreached = !ticket.firstRespondedAt && firstDue !== null && firstDue < now;
    const resolutionBreached = resolutionDue !== null && resolutionDue < now;
    const firstDueSoon = !ticket.firstRespondedAt && firstDue !== null && firstDue >= now && firstDue <= now + 60 * 60 * 1000;
    const resolutionDueSoon = resolutionDue !== null && resolutionDue >= now && resolutionDue <= now + 4 * 60 * 60 * 1000;
    const state = paused ? "paused" : firstBreached || resolutionBreached ? "breached" : firstDueSoon || resolutionDueSoon ? "due_soon" : "healthy";
    return { state, firstResponseDueAt: ticket.firstResponseDueAt ?? null, firstRespondedAt: ticket.firstRespondedAt ?? null, resolutionDueAt: ticket.resolutionDueAt ?? null, resolvedAt: ticket.resolvedAt ?? null, closedAt: ticket.closedAt ?? null };
  }

  private async hasActiveEscalation(ticketId: string) {
    return (await this.escalationRepository.count({ where: { ticketId, status: In(ACTIVE_ESCALATION_STATUSES) } })) > 0;
  }

  private hasPermission(actor: AdminRequestActor | null | undefined, permission: string) {
    return Boolean(actor?.permissionKeys.includes(permission));
  }

  private adminCan(admin: AdminUser, permission: string) {
    return (admin.roles ?? []).some((role) => (role.permissions ?? []).some((candidate) => candidate.key === permission));
  }

  private buildAuditSnapshot(ticket: ContactSubmission) {
    return {
      id: ticket.id,
      status: ticket.status,
      priority: ticket.priority,
      category: ticket.category ?? null,
      subcategory: ticket.subcategory ?? null,
      assignedAdminUserId: ticket.assignedAdminUserId ?? null,
      tags: ticket.tags,
      relatedUserId: ticket.relatedUserId ?? null,
      relatedRepitIds: ticket.relatedRepitIds,
      relatedModerationReportId: ticket.relatedModerationReportId ?? null,
      resolvedAt: ticket.resolvedAt?.toISOString?.() ?? null,
      closedAt: ticket.closedAt?.toISOString?.() ?? null,
    };
  }

  private safeFilterMetadata(query: AdminListSupportTicketsQueryDto) {
    return {
      searchApplied: Boolean(query.search?.trim()), status: query.status ?? null, priority: query.priority ?? null,
      category: query.category ?? null, assignment: query.assignment ?? null, source: query.source ?? null,
      escalation: query.escalation ?? null, slaState: query.slaState ?? null, dateFrom: query.dateFrom ?? null, dateTo: query.dateTo ?? null,
    };
  }

  private responseTimelineLabel(response: SupportTicketResponse) {
    if (response.status === "queued") return "Response queued";
    if (response.status === "sent_to_provider") return "Response sent to provider";
    if (response.status === "delivery_unknown") return "Response delivery unconfirmed";
    return response.failureCategory === "provider_failure" ? "Response rejected by provider" : "Response failed";
  }
}
