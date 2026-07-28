import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AdminAuditLog, NotificationCampaign, User } from "../../../entities";
import { NotificationsService } from "../../notifications/notifications.service";
import { AnalyticsService, ANALYTICS_EVENTS } from "../../analytics/analytics.service";
import { AdminAuditLogsService } from "../audit-logs/admin-audit-logs.service";

/** Hard cap on how many users a single campaign resolves for dispatch. */
const MAX_CAMPAIGN_RECIPIENTS = 50_000;
import type { AdminRequestActor, AdminRequestContext } from "../admin.types";
import { AdminNotificationActionDto } from "./dto/admin-notification-action.dto";
import { AdminNotificationScheduleDto } from "./dto/admin-notification-schedule.dto";
import { AdminCreateNotificationDto } from "./dto/admin-create-notification.dto";
import { AdminListNotificationsQueryDto } from "./dto/admin-list-notifications-query.dto";
import { AdminUpdateNotificationDto } from "./dto/admin-update-notification.dto";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function normalizeDateInput(value?: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

@Injectable()
export class AdminNotificationsService {
  constructor(
    @InjectRepository(NotificationCampaign)
    private readonly notificationRepository: Repository<NotificationCampaign>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(AdminAuditLog)
    private readonly auditLogRepository: Repository<AdminAuditLog>,
    private readonly auditLogsService: AdminAuditLogsService,
    private readonly pushService: NotificationsService,
    private readonly analytics: AnalyticsService,
  ) {}

  async listNotifications(query: AdminListNotificationsQueryDto) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(query.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const search = query.search?.trim() ?? "";
    const dateFrom = normalizeDateInput(query.dateFrom);
    const dateTo = normalizeDateInput(query.dateTo);

    if ((query.dateFrom && !dateFrom) || (query.dateTo && !dateTo)) {
      throw new BadRequestException("Invalid notification date filter");
    }

    const countQb = this.notificationRepository.createQueryBuilder("notification");
    this.applyFilters(countQb, { search, status: query.status, type: query.type, audience: query.audience, dateFrom, dateTo });
    const total = await countQb.getCount();

    const qb = this.notificationRepository.createQueryBuilder("notification");
    this.applyFilters(qb, { search, status: query.status, type: query.type, audience: query.audience, dateFrom, dateTo });
    this.applySorting(qb, query.sortBy, query.sortOrder);
    qb.offset((page - 1) * pageSize).limit(pageSize);

    const notifications = await qb.getMany();
    return {
      total,
      page,
      pageSize,
      records: notifications.map((notification) => this.serializeListItem(notification)),
    };
  }

  async getNotificationDetail(notificationId: string) {
    const notification = await this.requireNotification(notificationId);
    const auditLogs = await this.auditLogRepository.find({
      where: { targetType: "notification_campaign", targetId: notificationId },
      order: { createdAt: "DESC" },
      take: 50,
    });

    return {
      id: notification.id,
      title: notification.title,
      message: notification.message,
      audience: notification.audience,
      audienceFilters: notification.audienceFilters ?? {},
      type: notification.type,
      imageUrl: notification.imageUrl ?? null,
      deepLink: notification.deepLink ?? null,
      ctaLabel: notification.ctaLabel ?? null,
      status: notification.status,
      createdBy: notification.createdByAdminEmail
        ? { id: notification.createdByAdminUserId ?? null, email: notification.createdByAdminEmail }
        : null,
      updatedBy: notification.updatedByAdminEmail
        ? { id: notification.updatedByAdminUserId ?? null, email: notification.updatedByAdminEmail }
        : null,
      scheduledAt: notification.scheduledAt ?? null,
      sentAt: notification.sentAt ?? null,
      cancelledAt: notification.cancelledAt ?? null,
      failedAt: notification.failedAt ?? null,
      createdAt: notification.createdAt,
      updatedAt: notification.updatedAt,
      recipients: notification.recipientCount,
      // Honest delivery view: figures come only from real provider evidence
      // captured at send time. Metrics we do not instrument (open rate) are
      // reported as null, never fabricated from recipient or click counts.
      deliverySummary: {
        status: notification.status,
        delivered: notification.deliveredCount,
        failed: notification.failedCount,
        clicks: notification.clickCount,
        openRate: null,
        provider: notification.deliverySummary ?? null,
      },
      preview: {
        title: notification.title,
        message: notification.message,
        imageUrl: notification.imageUrl ?? null,
        ctaLabel: notification.ctaLabel ?? null,
        deepLink: notification.deepLink ?? null,
        type: notification.type,
      },
      history: auditLogs.map((log) => ({
        id: log.id,
        action: log.action,
        actorEmail: log.actorEmail ?? null,
        createdAt: log.createdAt,
        metadata: log.metadata ?? null,
      })),
    };
  }

  async createNotification(dto: AdminCreateNotificationDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    const entity = this.notificationRepository.create({
      title: dto.title,
      message: dto.message,
      audience: dto.audience,
      audienceFilters: dto.audienceFilters ?? {},
      type: dto.type,
      imageUrl: dto.imageUrl ?? null,
      deepLink: dto.deepLink ?? null,
      ctaLabel: dto.ctaLabel ?? null,
      status: "draft",
      createdByAdminUserId: actor?.id ?? null,
      createdByAdminEmail: actor?.email ?? null,
      updatedByAdminUserId: actor?.id ?? null,
      updatedByAdminEmail: actor?.email ?? null,
    });
    entity.recipientCount = await this.estimateAudience(entity.audience, entity.audienceFilters ?? {});
    const saved = await this.notificationRepository.save(entity);
    await this.auditLogsService.append({
      action: "admin.notifications.created",
      actor,
      context,
      targetType: "notification_campaign",
      targetId: saved.id,
      afterState: this.buildAuditSnapshot(saved),
    });
    return this.getNotificationDetail(saved.id);
  }

  async updateNotification(notificationId: string, dto: AdminUpdateNotificationDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    const notification = await this.requireNotification(notificationId);
    const beforeState = this.buildAuditSnapshot(notification);
    if (dto.title !== undefined) notification.title = dto.title;
    if (dto.message !== undefined) notification.message = dto.message;
    if (dto.audience !== undefined) notification.audience = dto.audience;
    if (dto.audienceFilters !== undefined) notification.audienceFilters = dto.audienceFilters;
    if (dto.type !== undefined) notification.type = dto.type;
    if (dto.imageUrl !== undefined) notification.imageUrl = dto.imageUrl;
    if (dto.deepLink !== undefined) notification.deepLink = dto.deepLink;
    if (dto.ctaLabel !== undefined) notification.ctaLabel = dto.ctaLabel;
    if (dto.status !== undefined) notification.status = dto.status;
    notification.updatedByAdminUserId = actor?.id ?? null;
    notification.updatedByAdminEmail = actor?.email ?? null;
    notification.recipientCount = await this.estimateAudience(notification.audience, notification.audienceFilters ?? {});
    const saved = await this.notificationRepository.save(notification);
    await this.auditLogsService.append({
      action: "admin.notifications.updated",
      actor,
      context,
      targetType: "notification_campaign",
      targetId: saved.id,
      beforeState,
      afterState: this.buildAuditSnapshot(saved),
    });
    return this.getNotificationDetail(saved.id);
  }

  async sendNotification(notificationId: string, dto: AdminNotificationActionDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    const notification = await this.requireNotification(notificationId);
    const beforeState = this.buildAuditSnapshot(notification);
    const processingStartedAt = new Date();
    notification.updatedByAdminUserId = actor?.id ?? null;
    notification.updatedByAdminEmail = actor?.email ?? null;
    notification.recipientCount = await this.estimateAudience(notification.audience, notification.audienceFilters ?? {});
    notification.cancelledAt = null;
    notification.failedAt = null;

    // Only push campaigns have a wired delivery channel. In-app/announcement/etc.
    // have no delivery infrastructure yet — report that honestly rather than
    // claiming delivery.
    if (notification.type !== "push") {
      notification.status = "delivery_unavailable";
      notification.deliveredCount = 0;
      notification.failedCount = 0;
      notification.deliverySummary = {
        channel: notification.type,
        channelAvailable: false,
        reason: "Delivery infrastructure unavailable for this channel (only push is implemented).",
        processedAt: processingStartedAt.toISOString(),
      };
    } else {
      const userIds = await this.resolveAudienceUserIds(notification.audience, notification.audienceFilters ?? {});
      const dispatch = await this.pushService.sendCampaign(userIds, {
        title: notification.title,
        body: notification.message,
        data: notification.deepLink ? { deepLink: notification.deepLink } : undefined,
      });

      notification.sentAt = new Date();
      notification.deliveredCount = dispatch.accepted;
      notification.failedCount = dispatch.rejected;
      notification.deliverySummary = {
        channel: "push",
        channelAvailable: dispatch.channelAvailable,
        targetedUsers: userIds.length,
        tokenCount: dispatch.tokenCount,
        successfulDeliveries: dispatch.accepted,
        failedDeliveries: dispatch.rejected,
        providerErrors: dispatch.errors.slice(0, 20),
        processingStartedAt: processingStartedAt.toISOString(),
        processedAt: notification.sentAt.toISOString(),
      };

      if (dispatch.tokenCount === 0) {
        // Provider was reachable but nobody in the audience has a device token.
        notification.status = "delivery_unavailable";
      } else if (dispatch.accepted === 0) {
        notification.status = "failed";
        notification.failedAt = notification.sentAt;
      } else if (dispatch.rejected > 0) {
        notification.status = "partially_delivered";
      } else {
        notification.status = "delivered";
      }
    }
    const saved = await this.notificationRepository.save(notification);
    await this.auditLogsService.append({
      action: "admin.notifications.sent",
      actor,
      context,
      targetType: "notification_campaign",
      targetId: saved.id,
      beforeState,
      afterState: this.buildAuditSnapshot(saved),
      metadata: dto.note?.trim() ? { note: dto.note.trim() } : null,
    });
    // Honest analytics: record the send attempt, and a delivery event ONLY when
    // the provider actually accepted at least one message.
    await this.analytics.track(ANALYTICS_EVENTS.NOTIFICATION_SENT, {
      properties: { notificationId: saved.id, status: saved.status, channel: saved.type },
    });
    if (saved.deliveredCount > 0) {
      await this.analytics.track(ANALYTICS_EVENTS.NOTIFICATION_DELIVERED, {
        properties: { notificationId: saved.id, delivered: saved.deliveredCount, failed: saved.failedCount },
      });
    }
    return this.getNotificationDetail(saved.id);
  }

  async scheduleNotification(notificationId: string, dto: AdminNotificationScheduleDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    const scheduledAt = normalizeDateInput(dto.scheduledAt);
    if (!scheduledAt) {
      throw new BadRequestException("Invalid notification schedule date");
    }
    const notification = await this.requireNotification(notificationId);
    const beforeState = this.buildAuditSnapshot(notification);
    notification.status = "scheduled";
    notification.scheduledAt = scheduledAt;
    notification.updatedByAdminUserId = actor?.id ?? null;
    notification.updatedByAdminEmail = actor?.email ?? null;
    const saved = await this.notificationRepository.save(notification);
    await this.auditLogsService.append({
      action: "admin.notifications.scheduled",
      actor,
      context,
      targetType: "notification_campaign",
      targetId: saved.id,
      beforeState,
      afterState: this.buildAuditSnapshot(saved),
      metadata: { scheduledAt: scheduledAt.toISOString(), note: dto.note?.trim() ?? null },
    });
    return this.getNotificationDetail(saved.id);
  }

  async cancelNotification(notificationId: string, dto: AdminNotificationActionDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    const notification = await this.requireNotification(notificationId);
    const beforeState = this.buildAuditSnapshot(notification);
    notification.status = "cancelled";
    notification.cancelledAt = new Date();
    notification.updatedByAdminUserId = actor?.id ?? null;
    notification.updatedByAdminEmail = actor?.email ?? null;
    const saved = await this.notificationRepository.save(notification);
    await this.auditLogsService.append({
      action: "admin.notifications.cancelled",
      actor,
      context,
      targetType: "notification_campaign",
      targetId: saved.id,
      beforeState,
      afterState: this.buildAuditSnapshot(saved),
      metadata: dto.note?.trim() ? { note: dto.note.trim() } : null,
    });
    return this.getNotificationDetail(saved.id);
  }

  async duplicateNotification(notificationId: string, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    const notification = await this.requireNotification(notificationId);
    const duplicate = this.notificationRepository.create({
      title: `${notification.title} (Copy)`,
      message: notification.message,
      audience: notification.audience,
      audienceFilters: notification.audienceFilters ?? {},
      type: notification.type,
      imageUrl: notification.imageUrl ?? null,
      deepLink: notification.deepLink ?? null,
      ctaLabel: notification.ctaLabel ?? null,
      status: "draft",
      createdByAdminUserId: actor?.id ?? null,
      createdByAdminEmail: actor?.email ?? null,
      updatedByAdminUserId: actor?.id ?? null,
      updatedByAdminEmail: actor?.email ?? null,
      duplicateOfNotificationId: notification.id,
      recipientCount: await this.estimateAudience(notification.audience, notification.audienceFilters ?? {}),
      deliveredCount: 0,
      failedCount: 0,
      clickCount: 0,
    });
    const saved = await this.notificationRepository.save(duplicate);
    await this.auditLogsService.append({
      action: "admin.notifications.duplicated",
      actor,
      context,
      targetType: "notification_campaign",
      targetId: saved.id,
      afterState: this.buildAuditSnapshot(saved),
      metadata: { sourceNotificationId: notification.id },
    });
    return this.getNotificationDetail(saved.id);
  }

  private async requireNotification(notificationId: string) {
    const notification = await this.notificationRepository.findOne({ where: { id: notificationId } });
    if (!notification) {
      throw new NotFoundException("Notification campaign not found");
    }
    return notification;
  }

  private applyFilters(
    qb: ReturnType<Repository<NotificationCampaign>["createQueryBuilder"]>,
    filters: {
      search?: string;
      status?: string;
      type?: string;
      audience?: string;
      dateFrom?: Date | null;
      dateTo?: Date | null;
    },
  ) {
    if (filters.search) {
      qb.andWhere("(notification.title ILIKE :search OR notification.message ILIKE :search)", {
        search: `%${filters.search}%`,
      });
    }
    if (filters.status) {
      qb.andWhere("notification.status = :status", { status: filters.status });
    }
    if (filters.type) {
      qb.andWhere("notification.type = :type", { type: filters.type });
    }
    if (filters.audience) {
      qb.andWhere("notification.audience = :audience", { audience: filters.audience });
    }
    if (filters.dateFrom) {
      qb.andWhere("notification.createdAt >= :dateFrom", { dateFrom: filters.dateFrom.toISOString() });
    }
    if (filters.dateTo) {
      qb.andWhere("notification.createdAt <= :dateTo", { dateTo: filters.dateTo.toISOString() });
    }
  }

  private applySorting(
    qb: ReturnType<Repository<NotificationCampaign>["createQueryBuilder"]>,
    sortBy?: string,
    sortOrder?: string,
  ) {
    const order = sortOrder?.toUpperCase() === "ASC" ? "ASC" : "DESC";
    switch (sortBy) {
      case "updatedAt":
        qb.orderBy("notification.updatedAt", order);
        break;
      case "scheduledAt":
        qb.orderBy("notification.scheduledAt", order);
        break;
      case "sentAt":
        qb.orderBy("notification.sentAt", order);
        break;
      case "status":
        qb.orderBy("notification.status", order);
        break;
      case "title":
        qb.orderBy("notification.title", order);
        break;
      default:
        qb.orderBy("notification.createdAt", order);
        break;
    }
  }

  private serializeListItem(notification: NotificationCampaign) {
    return {
      id: notification.id,
      title: notification.title,
      audience: notification.audience,
      type: notification.type,
      status: notification.status,
      scheduledAt: notification.scheduledAt ?? null,
      sentAt: notification.sentAt ?? null,
      recipientCount: notification.recipientCount,
      deliveredCount: notification.deliveredCount,
      failedCount: notification.failedCount,
      updatedAt: notification.updatedAt,
    };
  }

  /**
   * Resolve an audience definition to concrete user IDs for real dispatch.
   * Mirrors estimateAudience's predicates but returns IDs (capped) instead of a
   * count, so delivery is driven by real recipients rather than an estimate.
   */
  private async resolveAudienceUserIds(audience: string, filters: Record<string, unknown>): Promise<string[]> {
    if (audience === "specific_users") {
      return Array.isArray(filters.userIds)
        ? (filters.userIds as unknown[]).filter((id): id is string => typeof id === "string").slice(0, MAX_CAMPAIGN_RECIPIENTS)
        : [];
    }
    const qb = this.userRepository.createQueryBuilder("user").select("user.id", "id").limit(MAX_CAMPAIGN_RECIPIENTS);
    const threshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    if (audience === "active_users") {
      qb.where("user.lastLoginAt >= :threshold", { threshold });
    } else if (audience === "inactive_users") {
      qb.where("user.lastLoginAt IS NULL OR user.lastLoginAt < :threshold", { threshold });
    } else if (audience === "platform") {
      const platform = typeof filters.platform === "string" ? filters.platform : "";
      if (platform) qb.where(":platform = ANY(user.connectedPlatforms)", { platform });
    }
    const rows = await qb.getRawMany<{ id: string }>();
    return rows.map((row) => row.id);
  }

  private async estimateAudience(audience: string, filters: Record<string, unknown>) {
    if (audience === "specific_users") {
      return Array.isArray(filters.userIds) ? filters.userIds.length : 0;
    }
    if (audience === "active_users") {
      return this.userRepository
        .createQueryBuilder("user")
        .where("user.lastLoginAt >= :threshold", {
          threshold: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        })
        .getCount();
    }
    if (audience === "inactive_users") {
      return this.userRepository
        .createQueryBuilder("user")
        .where("user.lastLoginAt IS NULL OR user.lastLoginAt < :threshold", {
          threshold: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        })
        .getCount();
    }
    if (audience === "platform") {
      const platform = typeof filters.platform === "string" ? filters.platform : "";
      if (!platform) return this.userRepository.count();
      return this.userRepository
        .createQueryBuilder("user")
        .where(":platform = ANY(user.connectedPlatforms)", { platform })
        .getCount();
    }
    return this.userRepository.count();
  }

  private buildAuditSnapshot(notification: NotificationCampaign) {
    return {
      id: notification.id,
      title: notification.title,
      audience: notification.audience,
      type: notification.type,
      status: notification.status,
      scheduledAt: notification.scheduledAt?.toISOString?.() ?? null,
      sentAt: notification.sentAt?.toISOString?.() ?? null,
      cancelledAt: notification.cancelledAt?.toISOString?.() ?? null,
      recipientCount: notification.recipientCount,
      deliveredCount: notification.deliveredCount,
      failedCount: notification.failedCount,
    };
  }
}
