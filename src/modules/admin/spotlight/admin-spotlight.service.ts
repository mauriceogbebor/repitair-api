import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, EntityManager, Repository } from "typeorm";
import { AdminAuditLog, Spotlight } from "../../../entities";
import type { SpotlightStatus } from "../../../entities/spotlight.entity";
import { AdminAuditLogsService } from "../audit-logs/admin-audit-logs.service";
import type { AdminRequestActor, AdminRequestContext } from "../admin.types";
import { resolveDateRange } from "../utils/date-range";
import { AdminCreateSpotlightDto } from "./dto/admin-create-spotlight.dto";
import { AdminListSpotlightQueryDto } from "./dto/admin-list-spotlight-query.dto";
import { AdminScheduleSpotlightDto } from "./dto/admin-schedule-spotlight.dto";
import { AdminSpotlightActionDto } from "./dto/admin-spotlight-action.dto";
import { AdminUpdateSpotlightDto } from "./dto/admin-update-spotlight.dto";
import { SPOTLIGHT_CREATE_DESTINATION } from "./spotlight-destination";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const EDITABLE_STATUSES: SpotlightStatus[] = ["draft", "paused"];
const PUBLISHABLE_STATUSES: SpotlightStatus[] = ["draft", "paused"];
const PAUSABLE_STATUSES: SpotlightStatus[] = ["active", "scheduled"];

function parseDate(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException({ statusCode: 400, error: "InvalidSpotlightDate", message: `Invalid date value: ${value}` });
  }
  return parsed;
}

function nullableText(value?: string | null) {
  if (value === undefined) return undefined;
  return value?.trim() || null;
}

@Injectable()
export class AdminSpotlightService {
  constructor(
    @InjectRepository(Spotlight)
    private readonly spotlightRepository: Repository<Spotlight>,
    @InjectRepository(AdminAuditLog)
    private readonly auditLogRepository: Repository<AdminAuditLog>,
    private readonly dataSource: DataSource,
    private readonly auditLogsService: AdminAuditLogsService,
  ) {}

  async listCampaigns(query: AdminListSpotlightQueryDto) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(Math.max(query.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
    const qb = this.spotlightRepository.createQueryBuilder("spotlight");
    const search = query.search?.trim() ?? "";

    if (search) {
      qb.andWhere(
        "(spotlight.title ILIKE :search OR COALESCE(spotlight.subtitle, '') ILIKE :search OR spotlight.artist ILIKE :search OR COALESCE(spotlight.song, '') ILIKE :search OR COALESCE(spotlight.submitterEmail, '') ILIKE :search)",
        { search: `%${search}%` },
      );
    }

    if (query.status) {
      qb.andWhere("spotlight.status = :status", { status: query.status });
    }

    if (query.priority !== undefined && query.priority !== "") {
      const priority = Number(query.priority);
      if (!Number.isInteger(priority) || priority < 0) {
        throw new BadRequestException({ statusCode: 400, error: "InvalidPriority", message: "priority must be a non-negative integer" });
      }
      qb.andWhere("spotlight.priority = :priority", { priority });
    }

    const dateRange = resolveDateRange(query.dateFrom, query.dateTo, "spotlight createdAt");
    if (dateRange.start) qb.andWhere("spotlight.createdAt >= :dateFrom", { dateFrom: dateRange.start.toISOString() });
    if (dateRange.endExclusive) qb.andWhere("spotlight.createdAt < :dateTo", { dateTo: dateRange.endExclusive.toISOString() });

    const now = new Date();
    if (query.active === "true") {
      qb.andWhere("spotlight.status IN (:...deliveryStatuses)", { deliveryStatuses: ["active", "scheduled"] })
        .andWhere("(spotlight.startsAt IS NULL OR spotlight.startsAt <= :now)", { now: now.toISOString() })
        .andWhere("(spotlight.expiresAt IS NULL OR spotlight.expiresAt > :now)", { now: now.toISOString() });
    }
    if (query.scheduled === "true") {
      qb.andWhere("spotlight.status = 'scheduled'");
    }
    if (query.expired === "true") {
      qb.andWhere("spotlight.status = 'expired' OR (spotlight.expiresAt IS NOT NULL AND spotlight.expiresAt <= :nowExpired)", {
        nowExpired: now.toISOString(),
      });
    }

    const total = await qb.getCount();
    const order = query.sortOrder?.toUpperCase() === "ASC" ? "ASC" : "DESC";
    const orderBy = query.sortBy ?? "updatedAt";
    qb.orderBy(`spotlight.${orderBy}`, order).offset((page - 1) * pageSize).limit(pageSize);
    const campaigns = await qb.getMany();

    return {
      total,
      page,
      pageSize,
      records: campaigns.map((campaign) => this.serializeCampaignListItem(campaign)),
    };
  }

  async getCampaignDetail(campaignId: string) {
    const campaign = await this.requireCampaign(campaignId);
    const history = await this.auditLogRepository.find({
      where: { targetType: "spotlight", targetId: campaignId },
      order: { createdAt: "DESC" },
      take: 20,
    });

    return {
      ...this.serializeCampaignDetail(campaign),
      history: history.map((log) => ({
        id: log.id,
        action: log.action,
        actorEmail: log.actorEmail ?? null,
        createdAt: log.createdAt,
        metadata: log.metadata ?? null,
      })),
    };
  }

  async createCampaign(dto: AdminCreateSpotlightDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    const startsAt = parseDate(dto.startsAt);
    const expiresAt = parseDate(dto.expiresAt);
    this.validateWindow(startsAt, expiresAt);

    const campaignId = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Spotlight);
      const entity = repository.create({
        title: dto.title.trim(),
        subtitle: nullableText(dto.subtitle) ?? null,
        artist: dto.artist.trim(),
        song: nullableText(dto.song) ?? null,
        albumArt: dto.albumArt,
        backgroundImage: nullableText(dto.backgroundImage) ?? null,
        campaignType: dto.campaignType ?? "editorial",
        buttonLabel: "Create Repit",
        deepLink: SPOTLIGHT_CREATE_DESTINATION,
        tag: (dto.tag as Spotlight["tag"]) ?? "NEW_SINGLE",
        priority: dto.priority ?? 0,
        status: "draft",
        startsAt,
        expiresAt,
        submitterEmail: nullableText(dto.submitterEmail) ?? null,
        createdByAdminUserId: actor?.id ?? null,
        createdByAdminEmail: actor?.email ?? null,
        updatedByAdminUserId: actor?.id ?? null,
        updatedByAdminEmail: actor?.email ?? null,
      });
      const saved = await repository.save(entity);
      await this.auditLogsService.append({
        action: "admin.spotlight.created",
        actor,
        context,
        targetType: "spotlight",
        targetId: saved.id,
        afterState: this.buildAuditSnapshot(saved),
      }, manager);
      return saved.id;
    });
    return this.getCampaignDetail(campaignId);
  }

  async updateCampaign(campaignId: string, dto: AdminUpdateSpotlightDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Spotlight);
      const campaign = await this.requireCampaign(campaignId, manager);
      this.assertStatus(campaign, EDITABLE_STATUSES, "edit");
      const beforeState = this.buildAuditSnapshot(campaign);

      if (dto.title !== undefined) campaign.title = dto.title.trim();
      if (dto.subtitle !== undefined) campaign.subtitle = nullableText(dto.subtitle) ?? null;
      if (dto.artist !== undefined) campaign.artist = dto.artist.trim();
      if (dto.song !== undefined) campaign.song = nullableText(dto.song) ?? null;
      if (dto.albumArt !== undefined) campaign.albumArt = dto.albumArt;
      if (dto.backgroundImage !== undefined) campaign.backgroundImage = nullableText(dto.backgroundImage) ?? null;
      if (dto.campaignType !== undefined) campaign.campaignType = dto.campaignType;
      if (dto.buttonLabel !== undefined) campaign.buttonLabel = nullableText(dto.buttonLabel) ?? null;
      if (dto.deepLink !== undefined) campaign.deepLink = nullableText(dto.deepLink) ?? null;
      campaign.buttonLabel = "Create Repit";
      campaign.deepLink = SPOTLIGHT_CREATE_DESTINATION;
      if (dto.tag !== undefined) campaign.tag = dto.tag as Spotlight["tag"];
      if (dto.priority !== undefined) campaign.priority = dto.priority;
      if (dto.startsAt !== undefined) campaign.startsAt = parseDate(dto.startsAt);
      if (dto.expiresAt !== undefined) campaign.expiresAt = parseDate(dto.expiresAt);
      if (dto.submitterEmail !== undefined) campaign.submitterEmail = nullableText(dto.submitterEmail) ?? null;
      this.validateWindow(campaign.startsAt ?? null, campaign.expiresAt ?? null);
      campaign.updatedByAdminUserId = actor?.id ?? null;
      campaign.updatedByAdminEmail = actor?.email ?? null;

      const saved = await repository.save(campaign);
      await this.auditLogsService.append({
        action: "admin.spotlight.updated",
        actor,
        context,
        targetType: "spotlight",
        targetId: saved.id,
        beforeState,
        afterState: this.buildAuditSnapshot(saved),
      }, manager);
    });
    return this.getCampaignDetail(campaignId);
  }

  async publishCampaign(campaignId: string, dto: AdminSpotlightActionDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Spotlight);
      const campaign = await this.requireCampaign(campaignId, manager);
      this.assertStatus(campaign, PUBLISHABLE_STATUSES, "publish");
      const beforeState = this.buildAuditSnapshot(campaign);
      const now = new Date();
      this.validateForDelivery(campaign, now);
      if (campaign.startsAt && campaign.startsAt > now) {
        throw new ConflictException({ statusCode: 409, error: "SpotlightStartsInFuture", message: "Use Schedule for a campaign with a future start time." });
      }

      campaign.status = "active";
      campaign.publishedAt = now;
      campaign.archivedAt = null;
      campaign.updatedByAdminUserId = actor?.id ?? null;
      campaign.updatedByAdminEmail = actor?.email ?? null;
      const saved = await repository.save(campaign);
      await this.auditLogsService.append({
        action: "admin.spotlight.published",
        actor,
        context,
        targetType: "spotlight",
        targetId: saved.id,
        beforeState,
        afterState: this.buildAuditSnapshot(saved),
        metadata: dto.note ? { note: dto.note } : null,
      }, manager);
    });
    return this.getCampaignDetail(campaignId);
  }

  async pauseCampaign(campaignId: string, dto: AdminSpotlightActionDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Spotlight);
      const campaign = await this.requireCampaign(campaignId, manager);
      this.assertStatus(campaign, PAUSABLE_STATUSES, "pause");
      const beforeState = this.buildAuditSnapshot(campaign);
      campaign.status = "paused";
      campaign.updatedByAdminUserId = actor?.id ?? null;
      campaign.updatedByAdminEmail = actor?.email ?? null;
      const saved = await repository.save(campaign);
      await this.auditLogsService.append({
        action: "admin.spotlight.paused",
        actor,
        context,
        targetType: "spotlight",
        targetId: saved.id,
        beforeState,
        afterState: this.buildAuditSnapshot(saved),
        metadata: dto.note ? { note: dto.note } : null,
      }, manager);
    });
    return this.getCampaignDetail(campaignId);
  }

  async archiveCampaign(campaignId: string, dto: AdminSpotlightActionDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Spotlight);
      const campaign = await this.requireCampaign(campaignId, manager);
      if (campaign.status === "archived") {
        throw new ConflictException({ statusCode: 409, error: "SpotlightAlreadyArchived", message: "Spotlight campaign is already archived." });
      }
      const beforeState = this.buildAuditSnapshot(campaign);
      campaign.status = "archived";
      campaign.archivedAt = new Date();
      campaign.updatedByAdminUserId = actor?.id ?? null;
      campaign.updatedByAdminEmail = actor?.email ?? null;
      const saved = await repository.save(campaign);
      await this.auditLogsService.append({
        action: "admin.spotlight.archived",
        actor,
        context,
        targetType: "spotlight",
        targetId: saved.id,
        beforeState,
        afterState: this.buildAuditSnapshot(saved),
        metadata: dto.note ? { note: dto.note } : null,
      }, manager);
    });
    return this.getCampaignDetail(campaignId);
  }

  async scheduleCampaign(campaignId: string, dto: AdminScheduleSpotlightDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    const startsAt = parseDate(dto.startsAt);
    const expiresAt = parseDate(dto.expiresAt);
    if (!startsAt) throw new BadRequestException("A start time is required");
    const now = new Date();
    if (startsAt <= now) {
      throw new BadRequestException({ statusCode: 400, error: "InvalidSpotlightSchedule", message: "Start time must be in the future." });
    }
    this.validateWindow(startsAt, expiresAt);

    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Spotlight);
      const campaign = await this.requireCampaign(campaignId, manager);
      this.assertStatus(campaign, EDITABLE_STATUSES, "schedule");
      this.validateForDelivery({ ...campaign, startsAt, expiresAt } as Spotlight, now);
      const beforeState = this.buildAuditSnapshot(campaign);
      campaign.startsAt = startsAt;
      campaign.expiresAt = expiresAt;
      campaign.status = "scheduled";
      campaign.scheduledAt = now;
      campaign.updatedByAdminUserId = actor?.id ?? null;
      campaign.updatedByAdminEmail = actor?.email ?? null;
      const saved = await repository.save(campaign);
      await this.auditLogsService.append({
        action: "admin.spotlight.scheduled",
        actor,
        context,
        targetType: "spotlight",
        targetId: saved.id,
        beforeState,
        afterState: this.buildAuditSnapshot(saved),
        metadata: { startsAt: startsAt.toISOString(), expiresAt: expiresAt?.toISOString() ?? null },
      }, manager);
    });
    return this.getCampaignDetail(campaignId);
  }

  async duplicateCampaign(campaignId: string, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    const duplicateId = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Spotlight);
      const campaign = await this.requireCampaign(campaignId, manager);
      const duplicate = repository.create({
        title: `${campaign.title} (Copy)`,
        subtitle: campaign.subtitle,
        artist: campaign.artist,
        song: campaign.song,
        albumArt: campaign.albumArt,
        backgroundImage: campaign.backgroundImage,
        campaignType: campaign.campaignType,
        buttonLabel: "Create Repit",
        deepLink: SPOTLIGHT_CREATE_DESTINATION,
        tag: campaign.tag,
        priority: campaign.priority,
        status: "draft",
        startsAt: null,
        expiresAt: null,
        scheduledAt: null,
        submitterEmail: campaign.submitterEmail,
        createdByAdminUserId: actor?.id ?? null,
        createdByAdminEmail: actor?.email ?? null,
        updatedByAdminUserId: actor?.id ?? null,
        updatedByAdminEmail: actor?.email ?? null,
        duplicateOfSpotlightId: campaign.id,
      });
      const saved = await repository.save(duplicate);
      await this.auditLogsService.append({
        action: "admin.spotlight.duplicated",
        actor,
        context,
        targetType: "spotlight",
        targetId: saved.id,
        afterState: this.buildAuditSnapshot(saved),
        metadata: { sourceCampaignId: campaign.id },
      }, manager);
      return saved.id;
    });
    return this.getCampaignDetail(duplicateId);
  }

  private async requireCampaign(campaignId: string, manager?: EntityManager) {
    const repository = manager?.getRepository(Spotlight) ?? this.spotlightRepository;
    const campaign = await repository.findOne({
      where: { id: campaignId },
      ...(manager ? { lock: { mode: "pessimistic_write" as const } } : {}),
    });
    if (!campaign) {
      throw new NotFoundException("Spotlight campaign not found");
    }
    return campaign;
  }

  private assertStatus(campaign: Spotlight, allowed: SpotlightStatus[], action: string) {
    if (!allowed.includes(campaign.status)) {
      throw new ConflictException({
        statusCode: 409,
        error: "InvalidSpotlightTransition",
        message: `Cannot ${action} a spotlight campaign while it is ${campaign.status}.`,
      });
    }
  }

  private validateWindow(startsAt: Date | null, expiresAt: Date | null) {
    if (startsAt && expiresAt && expiresAt <= startsAt) {
      throw new BadRequestException({ statusCode: 400, error: "InvalidSpotlightSchedule", message: "End time must be after start time." });
    }
  }

  private validateForDelivery(campaign: Spotlight, now: Date) {
    if (!campaign.title.trim() || !campaign.artist.trim() || !campaign.albumArt.trim()) {
      throw new BadRequestException({ statusCode: 400, error: "SpotlightContentIncomplete", message: "Title, artist, and album artwork are required before delivery." });
    }
    if (!campaign.albumArt.startsWith("https://") || (campaign.backgroundImage && !campaign.backgroundImage.startsWith("https://"))) {
      throw new BadRequestException({ statusCode: 400, error: "UnsafeSpotlightMedia", message: "Spotlight media must use HTTPS URLs." });
    }
    this.validateWindow(campaign.startsAt ?? null, campaign.expiresAt ?? null);
    if (campaign.expiresAt && campaign.expiresAt <= now) {
      throw new BadRequestException({ statusCode: 400, error: "SpotlightAlreadyExpired", message: "Campaign expiry must be in the future." });
    }
  }

  private serializeCampaignListItem(campaign: Spotlight) {
    return {
      id: campaign.id,
      title: campaign.title,
      subtitle: campaign.subtitle ?? null,
      artist: campaign.artist,
      song: campaign.song ?? null,
      albumArt: campaign.albumArt,
      priority: campaign.priority,
      campaignType: campaign.campaignType,
      status: campaign.status,
      startsAt: campaign.startsAt ?? null,
      expiresAt: campaign.expiresAt ?? null,
      impressionCount: campaign.impressionCount,
      tapCount: campaign.tapCount,
      ctr: campaign.impressionCount > 0 ? Number(((campaign.tapCount / campaign.impressionCount) * 100).toFixed(2)) : null,
      updatedAt: campaign.updatedAt,
    };
  }

  private serializeCampaignDetail(campaign: Spotlight) {
    return {
      id: campaign.id,
      title: campaign.title,
      subtitle: campaign.subtitle ?? null,
      artist: campaign.artist,
      song: campaign.song ?? null,
      albumArt: campaign.albumArt,
      backgroundImage: campaign.backgroundImage ?? null,
      tag: campaign.tag,
      buttonLabel: "Create Repit",
      destination: SPOTLIGHT_CREATE_DESTINATION,
      priority: campaign.priority,
      campaignType: campaign.campaignType,
      status: campaign.status,
      createdBy: campaign.createdByAdminEmail ? { id: campaign.createdByAdminUserId ?? null, email: campaign.createdByAdminEmail } : null,
      updatedBy: campaign.updatedByAdminEmail ? { id: campaign.updatedByAdminUserId ?? null, email: campaign.updatedByAdminEmail } : null,
      startsAt: campaign.startsAt ?? null,
      expiresAt: campaign.expiresAt ?? null,
      scheduledAt: campaign.scheduledAt ?? null,
      publishedAt: campaign.publishedAt ?? null,
      archivedAt: campaign.archivedAt ?? null,
      createdAt: campaign.createdAt,
      updatedAt: campaign.updatedAt,
      submitterEmail: campaign.submitterEmail ?? null,
      preview: {
        title: campaign.title,
        subtitle: campaign.subtitle ?? campaign.artist,
        artist: campaign.artist,
        song: campaign.song ?? null,
        albumArt: campaign.albumArt,
        tag: campaign.tag,
        destination: SPOTLIGHT_CREATE_DESTINATION,
        buttonLabel: "Create Repit",
        backgroundImage: campaign.backgroundImage ?? null,
      },
      metrics: {
        impressions: campaign.impressionCount,
        taps: campaign.tapCount,
        ctr: campaign.impressionCount > 0 ? Number(((campaign.tapCount / campaign.impressionCount) * 100).toFixed(2)) : 0,
      },
    };
  }

  private buildAuditSnapshot(campaign: Spotlight) {
    return {
      id: campaign.id,
      title: campaign.title,
      subtitle: campaign.subtitle ?? null,
      artist: campaign.artist,
      song: campaign.song ?? null,
      albumArt: campaign.albumArt,
      backgroundImage: campaign.backgroundImage ?? null,
      campaignType: campaign.campaignType,
      buttonLabel: campaign.buttonLabel ?? null,
      destination: campaign.deepLink ?? null,
      priority: campaign.priority,
      status: campaign.status,
      startsAt: campaign.startsAt?.toISOString?.() ?? null,
      expiresAt: campaign.expiresAt?.toISOString?.() ?? null,
      scheduledAt: campaign.scheduledAt?.toISOString?.() ?? null,
      publishedAt: campaign.publishedAt?.toISOString?.() ?? null,
      archivedAt: campaign.archivedAt?.toISOString?.() ?? null,
      submitterEmail: campaign.submitterEmail ?? null,
      impressionCount: campaign.impressionCount,
      tapCount: campaign.tapCount,
    };
  }
}
