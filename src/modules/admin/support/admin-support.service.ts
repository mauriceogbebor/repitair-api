import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AdminAuditLog, ContactSubmission, NotificationCampaign, Repit, SupportTicketNote, User } from "../../../entities";
import { AdminAuditLogsService } from "../audit-logs/admin-audit-logs.service";
import type { AdminRequestActor, AdminRequestContext } from "../admin.types";
import { AdminAddSupportTicketNoteDto } from "./dto/admin-add-support-ticket-note.dto";
import { AdminAssignSupportTicketDto } from "./dto/admin-assign-support-ticket.dto";
import { AdminCreateSupportTicketDto } from "./dto/admin-create-support-ticket.dto";
import { AdminListSupportTicketsQueryDto } from "./dto/admin-list-support-tickets-query.dto";
import { AdminReopenSupportTicketDto } from "./dto/admin-reopen-support-ticket.dto";
import { AdminResolveSupportTicketDto } from "./dto/admin-resolve-support-ticket.dto";
import { AdminUpdateSupportTicketDto } from "./dto/admin-update-support-ticket.dto";
import { AdminUpdateSupportTicketPriorityDto } from "./dto/admin-update-support-ticket-priority.dto";
import { AdminUpdateSupportTicketStatusDto } from "./dto/admin-update-support-ticket-status.dto";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function normalizeDateInput(value?: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function applyDefaultSla(ticket: ContactSubmission) {
  const createdAt = ticket.createdAt ? new Date(ticket.createdAt) : new Date();
  if (!ticket.firstResponseDueAt) {
    ticket.firstResponseDueAt = new Date(createdAt.getTime() + 4 * 60 * 60 * 1000);
  }
  if (!ticket.resolutionDueAt) {
    ticket.resolutionDueAt = new Date(createdAt.getTime() + 48 * 60 * 60 * 1000);
  }
}

@Injectable()
export class AdminSupportService {
  constructor(
    @InjectRepository(ContactSubmission)
    private readonly ticketRepository: Repository<ContactSubmission>,
    @InjectRepository(SupportTicketNote)
    private readonly supportNoteRepository: Repository<SupportTicketNote>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Repit)
    private readonly repitRepository: Repository<Repit>,
    @InjectRepository(NotificationCampaign)
    private readonly notificationRepository: Repository<NotificationCampaign>,
    @InjectRepository(AdminAuditLog)
    private readonly auditLogRepository: Repository<AdminAuditLog>,
    private readonly auditLogsService: AdminAuditLogsService,
  ) {}

  async listTickets(query: AdminListSupportTicketsQueryDto) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(query.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const search = query.search?.trim() ?? "";
    const dateFrom = normalizeDateInput(query.dateFrom);
    const dateTo = normalizeDateInput(query.dateTo);

    if ((query.dateFrom && !dateFrom) || (query.dateTo && !dateTo)) {
      throw new BadRequestException("Invalid support date filter");
    }

    const countQb = this.ticketRepository.createQueryBuilder("ticket");
    this.applyFilters(countQb, {
      search,
      status: query.status,
      priority: query.priority,
      category: query.category,
      assignedAdminUserId: query.assignedAdminUserId,
      tag: query.tag,
      dateFrom,
      dateTo,
    });
    const total = await countQb.getCount();

    const qb = this.ticketRepository.createQueryBuilder("ticket");
    this.applyFilters(qb, {
      search,
      status: query.status,
      priority: query.priority,
      category: query.category,
      assignedAdminUserId: query.assignedAdminUserId,
      tag: query.tag,
      dateFrom,
      dateTo,
    });
    this.applySorting(qb, query.sortBy, query.sortOrder);
    qb.offset((page - 1) * pageSize).limit(pageSize);

    const tickets = await qb.getMany();

    return {
      total,
      page,
      pageSize,
      records: tickets.map((ticket) => this.serializeListItem(ticket)),
    };
  }

  async getTicketDetail(ticketId: string) {
    const ticket = await this.requireTicket(ticketId);
    const [notes, relatedUser, auditLogs, relatedRepits, relatedNotifications] = await Promise.all([
      this.supportNoteRepository.find({ where: { ticketId }, order: { createdAt: "DESC" } }),
      ticket.relatedUserId ? this.userRepository.findOne({ where: { id: ticket.relatedUserId } }) : Promise.resolve(null),
      this.auditLogRepository.find({
        where: { targetType: "support_ticket", targetId: ticket.id },
        order: { createdAt: "DESC" },
        take: 50,
      }),
      ticket.relatedRepitIds.length > 0
        ? await this.repitRepository.find({
            where: ticket.relatedRepitIds.map((id) => ({ id })),
            relations: { user: true, template: true },
          })
        : Promise.resolve([]),
      ticket.relatedNotificationIds.length > 0
        ? await this.notificationRepository.find({
            where: ticket.relatedNotificationIds.map((id) => ({ id })),
          })
        : Promise.resolve([]),
    ]);

    const timeline = [
      ...notes.map((note) => ({
        id: `note-${note.id}`,
        type: "internal_note",
        occurredAt: note.createdAt.toISOString(),
        label: "Internal note added",
        detail: note.authorAdminEmail ? `By ${note.authorAdminEmail}` : "Internal note created",
      })),
      ...auditLogs.map((log) => ({
        id: `audit-${log.id}`,
        type: "audit",
        occurredAt: log.createdAt.toISOString(),
        label: log.action,
        detail: log.actorEmail ? `By ${log.actorEmail}` : "Admin action recorded",
      })),
    ].sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime());

    return {
      id: ticket.id,
      subject: ticket.subject,
      description: ticket.message,
      user: relatedUser
        ? { id: relatedUser.id, fullName: relatedUser.fullName, email: relatedUser.email }
        : { id: ticket.relatedUserId ?? null, fullName: ticket.name, email: ticket.email },
      assignedAdmin: ticket.assignedAdminEmail
        ? { id: ticket.assignedAdminUserId ?? null, email: ticket.assignedAdminEmail }
        : null,
      priority: ticket.priority,
      category: ticket.category ?? null,
      tags: ticket.tags,
      status: ticket.status,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
      sla: {
        firstResponseDueAt: ticket.firstResponseDueAt ?? null,
        resolutionDueAt: ticket.resolutionDueAt ?? null,
        resolvedAt: ticket.resolvedAt ?? null,
        closedAt: ticket.closedAt ?? null,
      },
      timeline,
      internalNotes: notes.map((note) => ({
        id: note.id,
        body: note.body,
        authorEmail: note.authorAdminEmail ?? null,
        createdAt: note.createdAt,
      })),
      relatedRepits: relatedRepits.map((repit) => ({
        id: repit.id,
        title: repit.title,
        artist: repit.artist ?? null,
        status: repit.moderationStatus,
        templateId: repit.templateId,
      })),
      relatedNotifications: relatedNotifications.map((notification) => ({
        id: notification.id,
        title: notification.title,
        status: notification.status,
        type: notification.type,
      })),
      relatedAuditLogs: auditLogs.map((log) => ({
        id: log.id,
        action: log.action,
        actorEmail: log.actorEmail ?? null,
        createdAt: log.createdAt,
        metadata: log.metadata ?? null,
      })),
    };
  }

  async createTicket(dto: AdminCreateSupportTicketDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    const entity = this.ticketRepository.create({
      name: dto.name,
      email: dto.email.toLowerCase(),
      subject: dto.subject,
      message: dto.message,
      priority: dto.priority ?? "medium",
      category: dto.category ?? null,
      tags: dto.tags ?? [],
      relatedUserId: dto.relatedUserId ?? null,
      relatedRepitIds: dto.relatedRepitIds ?? [],
      relatedNotificationIds: [],
      status: "new",
      source: "admin",
    });
    applyDefaultSla(entity);
    const saved = await this.ticketRepository.save(entity);
    await this.auditLogsService.append({
      action: "admin.support.ticket_created",
      actor,
      context,
      targetType: "support_ticket",
      targetId: saved.id,
      afterState: this.buildAuditSnapshot(saved),
    });
    return this.getTicketDetail(saved.id);
  }

  async updateTicket(ticketId: string, dto: AdminUpdateSupportTicketDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    const ticket = await this.requireTicket(ticketId);
    const beforeState = this.buildAuditSnapshot(ticket);
    if (dto.subject !== undefined) ticket.subject = dto.subject;
    if (dto.message !== undefined) ticket.message = dto.message;
    if (dto.category !== undefined) ticket.category = dto.category;
    if (dto.tags !== undefined) ticket.tags = dto.tags;
    if (dto.relatedUserId !== undefined) ticket.relatedUserId = dto.relatedUserId;
    if (dto.relatedRepitIds !== undefined) ticket.relatedRepitIds = dto.relatedRepitIds;
    if (dto.relatedNotificationIds !== undefined) ticket.relatedNotificationIds = dto.relatedNotificationIds;
    const saved = await this.ticketRepository.save(ticket);
    await this.auditLogsService.append({
      action: "admin.support.ticket_updated",
      actor,
      context,
      targetType: "support_ticket",
      targetId: saved.id,
      beforeState,
      afterState: this.buildAuditSnapshot(saved),
    });
    return this.getTicketDetail(saved.id);
  }

  async assignTicket(ticketId: string, dto: AdminAssignSupportTicketDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    const ticket = await this.requireTicket(ticketId);
    const beforeState = this.buildAuditSnapshot(ticket);
    ticket.assignedAdminUserId = dto.adminUserId ?? actor?.id ?? null;
    ticket.assignedAdminEmail = dto.adminEmail ?? actor?.email ?? null;
    ticket.status = "assigned";
    ticket.lastAdminReplyAt = new Date();
    const saved = await this.ticketRepository.save(ticket);
    await this.auditLogsService.append({
      action: "admin.support.ticket_assigned",
      actor,
      context,
      targetType: "support_ticket",
      targetId: saved.id,
      beforeState,
      afterState: this.buildAuditSnapshot(saved),
      metadata: {
        assignedAdminUserId: saved.assignedAdminUserId,
        assignedAdminEmail: saved.assignedAdminEmail,
      },
    });
    return this.getTicketDetail(saved.id);
  }

  async updateStatus(ticketId: string, dto: AdminUpdateSupportTicketStatusDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    const ticket = await this.requireTicket(ticketId);
    const beforeState = this.buildAuditSnapshot(ticket);
    ticket.status = dto.status;
    if (dto.status === "resolved") {
      ticket.resolvedAt = new Date();
    }
    if (dto.status === "closed") {
      ticket.closedAt = new Date();
    }
    const saved = await this.ticketRepository.save(ticket);
    await this.auditLogsService.append({
      action: "admin.support.ticket_status_changed",
      actor,
      context,
      targetType: "support_ticket",
      targetId: saved.id,
      beforeState,
      afterState: this.buildAuditSnapshot(saved),
      metadata: { status: dto.status },
    });
    return this.getTicketDetail(saved.id);
  }

  async updatePriority(ticketId: string, dto: AdminUpdateSupportTicketPriorityDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    const ticket = await this.requireTicket(ticketId);
    const beforeState = this.buildAuditSnapshot(ticket);
    ticket.priority = dto.priority;
    const saved = await this.ticketRepository.save(ticket);
    await this.auditLogsService.append({
      action: "admin.support.ticket_priority_changed",
      actor,
      context,
      targetType: "support_ticket",
      targetId: saved.id,
      beforeState,
      afterState: this.buildAuditSnapshot(saved),
      metadata: { priority: dto.priority },
    });
    return this.getTicketDetail(saved.id);
  }

  async addNote(ticketId: string, dto: AdminAddSupportTicketNoteDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    await this.requireTicket(ticketId);
    const note = this.supportNoteRepository.create({
      ticketId,
      body: dto.body,
      authorAdminUserId: actor?.id ?? null,
      authorAdminEmail: actor?.email ?? null,
    });
    const saved = await this.supportNoteRepository.save(note);
    await this.auditLogsService.append({
      action: "admin.support.note_added",
      actor,
      context,
      targetType: "support_ticket",
      targetId: ticketId,
      metadata: { noteId: saved.id, bodyPreview: dto.body.slice(0, 120) },
    });
    return this.getTicketDetail(ticketId);
  }

  async resolveTicket(ticketId: string, dto: AdminResolveSupportTicketDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    const ticket = await this.requireTicket(ticketId);
    const beforeState = this.buildAuditSnapshot(ticket);
    ticket.status = "resolved";
    ticket.resolvedAt = new Date();
    const saved = await this.ticketRepository.save(ticket);
    if (dto.resolutionNote?.trim()) {
      await this.supportNoteRepository.save(
        this.supportNoteRepository.create({
          ticketId,
          body: dto.resolutionNote.trim(),
          authorAdminUserId: actor?.id ?? null,
          authorAdminEmail: actor?.email ?? null,
        }),
      );
    }
    await this.auditLogsService.append({
      action: "admin.support.ticket_resolved",
      actor,
      context,
      targetType: "support_ticket",
      targetId: ticketId,
      beforeState,
      afterState: this.buildAuditSnapshot(saved),
      metadata: dto.resolutionNote?.trim() ? { resolutionNote: dto.resolutionNote.trim() } : null,
    });
    return this.getTicketDetail(ticketId);
  }

  async reopenTicket(ticketId: string, dto: AdminReopenSupportTicketDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    const ticket = await this.requireTicket(ticketId);
    const beforeState = this.buildAuditSnapshot(ticket);
    ticket.status = "open";
    ticket.resolvedAt = null;
    ticket.closedAt = null;
    const saved = await this.ticketRepository.save(ticket);
    await this.auditLogsService.append({
      action: "admin.support.ticket_reopened",
      actor,
      context,
      targetType: "support_ticket",
      targetId: ticketId,
      beforeState,
      afterState: this.buildAuditSnapshot(saved),
      metadata: dto.reason?.trim() ? { reason: dto.reason.trim() } : null,
    });
    return this.getTicketDetail(ticketId);
  }

  private async requireTicket(ticketId: string) {
    const ticket = await this.ticketRepository.findOne({ where: { id: ticketId } });
    if (!ticket) {
      throw new NotFoundException("Support ticket not found");
    }
    if (!Array.isArray(ticket.tags)) ticket.tags = [];
    if (!Array.isArray(ticket.relatedRepitIds)) ticket.relatedRepitIds = [];
    if (!Array.isArray(ticket.relatedNotificationIds)) ticket.relatedNotificationIds = [];
    return ticket;
  }

  private applyFilters(
    qb: ReturnType<Repository<ContactSubmission>["createQueryBuilder"]>,
    filters: {
      search?: string;
      status?: string;
      priority?: string;
      category?: string;
      assignedAdminUserId?: string;
      tag?: string;
      dateFrom?: Date | null;
      dateTo?: Date | null;
    },
  ) {
    if (filters.search) {
      qb.andWhere(
        "(ticket.id::text ILIKE :search OR ticket.subject ILIKE :search OR ticket.message ILIKE :search OR ticket.name ILIKE :search OR ticket.email ILIKE :search)",
        { search: `%${filters.search}%` },
      );
    }
    if (filters.status) {
      qb.andWhere("ticket.status = :status", { status: filters.status });
    }
    if (filters.priority) {
      qb.andWhere("ticket.priority = :priority", { priority: filters.priority });
    }
    if (filters.category) {
      qb.andWhere("ticket.category = :category", { category: filters.category });
    }
    if (filters.assignedAdminUserId) {
      qb.andWhere("ticket.assignedAdminUserId = :assignedAdminUserId", { assignedAdminUserId: filters.assignedAdminUserId });
    }
    if (filters.tag) {
      qb.andWhere(":tag = ANY(ticket.tags)", { tag: filters.tag });
    }
    if (filters.dateFrom) {
      qb.andWhere("ticket.createdAt >= :dateFrom", { dateFrom: filters.dateFrom.toISOString() });
    }
    if (filters.dateTo) {
      qb.andWhere("ticket.createdAt <= :dateTo", { dateTo: filters.dateTo.toISOString() });
    }
  }

  private applySorting(
    qb: ReturnType<Repository<ContactSubmission>["createQueryBuilder"]>,
    sortBy?: string,
    sortOrder?: string,
  ) {
    const order = sortOrder?.toUpperCase() === "ASC" ? "ASC" : "DESC";
    switch (sortBy) {
      case "updatedAt":
        qb.orderBy("ticket.updatedAt", order);
        break;
      case "priority":
        qb.orderBy("ticket.priority", order);
        break;
      case "status":
        qb.orderBy("ticket.status", order);
        break;
      case "subject":
        qb.orderBy("ticket.subject", order);
        break;
      default:
        qb.orderBy("ticket.createdAt", order);
        break;
    }
  }

  private serializeListItem(ticket: ContactSubmission) {
    return {
      id: ticket.id,
      subject: ticket.subject,
      userName: ticket.name,
      userEmail: ticket.email,
      assignedAdminEmail: ticket.assignedAdminEmail ?? null,
      priority: ticket.priority,
      category: ticket.category ?? null,
      status: ticket.status,
      tags: ticket.tags,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
      sla: {
        firstResponseDueAt: ticket.firstResponseDueAt ?? null,
        resolutionDueAt: ticket.resolutionDueAt ?? null,
      },
    };
  }

  private buildAuditSnapshot(ticket: ContactSubmission) {
    return {
      id: ticket.id,
      subject: ticket.subject,
      email: ticket.email,
      status: ticket.status,
      priority: ticket.priority,
      category: ticket.category ?? null,
      assignedAdminUserId: ticket.assignedAdminUserId ?? null,
      assignedAdminEmail: ticket.assignedAdminEmail ?? null,
      tags: ticket.tags,
      relatedUserId: ticket.relatedUserId ?? null,
      relatedRepitIds: ticket.relatedRepitIds,
      relatedNotificationIds: ticket.relatedNotificationIds,
      resolvedAt: ticket.resolvedAt?.toISOString?.() ?? null,
      closedAt: ticket.closedAt?.toISOString?.() ?? null,
    };
  }
}
