import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AdminAuditLog, Spotlight } from "../../../entities";
import { AdminAuditLogsService } from "../audit-logs/admin-audit-logs.service";
import type { AdminRequestActor, AdminRequestContext } from "../admin.types";
import { AdminCreateSpotlightDto } from "./dto/admin-create-spotlight.dto";
import { AdminListSpotlightQueryDto } from "./dto/admin-list-spotlight-query.dto";
import { AdminScheduleSpotlightDto } from "./dto/admin-schedule-spotlight.dto";
import { AdminSpotlightActionDto } from "./dto/admin-spotlight-action.dto";
import { AdminUpdateSpotlightDto } from "./dto/admin-update-spotlight.dto";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function parseDate(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`Invalid date value: ${value}`);
  }
  return parsed;
}

@Injectable()
export class AdminSpotlightService {
  constructor(
    @InjectRepository(Spotlight)
    private readonly spotlightRepository: Repository<Spotlight>,
    @InjectRepository(AdminAuditLog)
    private readonly auditLogRepository: Repository<AdminAuditLog>,
    private readonly auditLogsService: AdminAuditLogsService,
  ) {}

  async listCampaigns(query: AdminListSpotlightQueryDto) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(query.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
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

    if (query.priority) {
      qb.andWhere("spotlight.priority = :priority", { priority: Number(query.priority) });
    }

    const dateFrom = query.dateFrom ? parseDate(query.dateFrom) : null;
    const dateTo = query.dateTo ? parseDate(query.dateTo) : null;
    if (dateFrom) qb.andWhere("spotlight.createdAt >= :dateFrom", { dateFrom: dateFrom.toISOString() });
    if (dateTo) qb.andWhere("spotlight.createdAt <= :dateTo", { dateTo: dateTo.toISOString() });

    const now = new Date();
    if (query.active === "true") {
      qb.andWhere("spotlight.status = 'active'")
        .andWhere("(spotlight.startsAt IS NULL OR spotlight.startsAt <= :now)", { now: now.toISOString() })
        .andWhere("(spotlight.expiresAt IS NULL OR spotlight.expiresAt >= :now)", { now: now.toISOString() });
    }
    if (query.scheduled === "true") {
      qb.andWhere("spotlight.status = 'scheduled'");
    }
    if (query.expired === "true") {
      qb.andWhere("spotlight.status = 'expired' OR (spotlight.expiresAt IS NOT NULL AND spotlight.expiresAt < :nowExpired)", {
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
    const entity = this.spotlightRepository.create({
      title: dto.title,
      subtitle: dto.subtitle ?? null,
      artist: dto.artist,
      song: dto.song ?? null,
      albumArt: dto.albumArt,
      backgroundImage: dto.backgroundImage ?? null,
      campaignType: dto.campaignType ?? "editorial",
      buttonLabel: dto.buttonLabel ?? null,
      deepLink: dto.deepLink ?? null,
      tag: (dto.tag as any) ?? "NEW_SINGLE",
      priority: dto.priority ?? 0,
      status: (dto.status as any) ?? "draft",
      startsAt: parseDate(dto.startsAt),
      expiresAt: parseDate(dto.expiresAt),
      submitterEmail: dto.submitterEmail ?? null,
      createdByAdminUserId: actor?.id ?? null,
      createdByAdminEmail: actor?.email ?? null,
      updatedByAdminUserId: actor?.id ?? null,
      updatedByAdminEmail: actor?.email ?? null,
    });
    const saved = await this.spotlightRepository.save(entity);
    await this.auditLogsService.append({
      action: "admin.spotlight.created",
      actor,
      context,
      targetType: "spotlight",
      targetId: saved.id,
      afterState: this.buildAuditSnapshot(saved),
    });
    return this.getCampaignDetail(saved.id);
  }

  async updateCampaign(campaignId: string, dto: AdminUpdateSpotlightDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    const campaign = await this.requireCampaign(campaignId);
    const beforeState = this.buildAuditSnapshot(campaign);
    Object.assign(campaign, {
      title: dto.title ?? campaign.title,
      subtitle: dto.subtitle ?? campaign.subtitle,
      artist: dto.artist ?? campaign.artist,
      song: dto.song ?? campaign.song,
      albumArt: dto.albumArt ?? campaign.albumArt,
      backgroundImage: dto.backgroundImage ?? campaign.backgroundImage,
      campaignType: dto.campaignType ?? campaign.campaignType,
      buttonLabel: dto.buttonLabel ?? campaign.buttonLabel,
      deepLink: dto.deepLink ?? campaign.deepLink,
      tag: (dto.tag as any) ?? campaign.tag,
      priority: dto.priority ?? campaign.priority,
      status: (dto.status as any) ?? campaign.status,
      startsAt: dto.startsAt !== undefined ? parseDate(dto.startsAt) : campaign.startsAt,
      expiresAt: dto.expiresAt !== undefined ? parseDate(dto.expiresAt) : campaign.expiresAt,
      submitterEmail: dto.submitterEmail ?? campaign.submitterEmail,
      updatedByAdminUserId: actor?.id ?? null,
      updatedByAdminEmail: actor?.email ?? null,
    });
    const saved = await this.spotlightRepository.save(campaign);
    await this.auditLogsService.append({
      action: "admin.spotlight.updated",
      actor,
      context,
      targetType: "spotlight",
      targetId: saved.id,
      beforeState,
      afterState: this.buildAuditSnapshot(saved),
    });
    return this.getCampaignDetail(saved.id);
  }

  async publishCampaign(campaignId: string, dto: AdminSpotlightActionDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    const campaign = await this.requireCampaign(campaignId);
    const beforeState = this.buildAuditSnapshot(campaign);
    campaign.status = "active";
    campaign.publishedAt = new Date();
    campaign.archivedAt = null;
    campaign.updatedByAdminUserId = actor?.id ?? null;
    campaign.updatedByAdminEmail = actor?.email ?? null;
    const saved = await this.spotlightRepository.save(campaign);
    await this.auditLogsService.append({
      action: "admin.spotlight.published",
      actor,
      context,
      targetType: "spotlight",
      targetId: saved.id,
      beforeState,
      afterState: this.buildAuditSnapshot(saved),
      metadata: dto.note ? { note: dto.note } : null,
    });
    return this.getCampaignDetail(saved.id);
  }

  async archiveCampaign(campaignId: string, dto: AdminSpotlightActionDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    const campaign = await this.requireCampaign(campaignId);
    const beforeState = this.buildAuditSnapshot(campaign);
    campaign.status = "archived";
    campaign.archivedAt = new Date();
    campaign.updatedByAdminUserId = actor?.id ?? null;
    campaign.updatedByAdminEmail = actor?.email ?? null;
    const saved = await this.spotlightRepository.save(campaign);
    await this.auditLogsService.append({
      action: "admin.spotlight.archived",
      actor,
      context,
      targetType: "spotlight",
      targetId: saved.id,
      beforeState,
      afterState: this.buildAuditSnapshot(saved),
      metadata: dto.note ? { note: dto.note } : null,
    });
    return this.getCampaignDetail(saved.id);
  }

  async scheduleCampaign(campaignId: string, dto: AdminScheduleSpotlightDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    const campaign = await this.requireCampaign(campaignId);
    const beforeState = this.buildAuditSnapshot(campaign);
    campaign.startsAt = parseDate(dto.startsAt) ?? campaign.startsAt;
    campaign.expiresAt = parseDate(dto.expiresAt) ?? campaign.expiresAt;
    campaign.status = "scheduled";
    campaign.scheduledAt = new Date();
    campaign.updatedByAdminUserId = actor?.id ?? null;
    campaign.updatedByAdminEmail = actor?.email ?? null;
    const saved = await this.spotlightRepository.save(campaign);
    await this.auditLogsService.append({
      action: "admin.spotlight.scheduled",
      actor,
      context,
      targetType: "spotlight",
      targetId: saved.id,
      beforeState,
      afterState: this.buildAuditSnapshot(saved),
      metadata: { startsAt: saved.startsAt?.toISOString?.() ?? null, expiresAt: saved.expiresAt?.toISOString?.() ?? null },
    });
    return this.getCampaignDetail(saved.id);
  }

  async duplicateCampaign(campaignId: string, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    const campaign = await this.requireCampaign(campaignId);
    const duplicate = this.spotlightRepository.create({
      title: `${campaign.title} (Copy)`,
      subtitle: campaign.subtitle,
      artist: campaign.artist,
      song: campaign.song,
      albumArt: campaign.albumArt,
      backgroundImage: campaign.backgroundImage,
      campaignType: campaign.campaignType,
      buttonLabel: campaign.buttonLabel,
      deepLink: campaign.deepLink,
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
    const saved = await this.spotlightRepository.save(duplicate);
    await this.auditLogsService.append({
      action: "admin.spotlight.duplicated",
      actor,
      context,
      targetType: "spotlight",
      targetId: saved.id,
      afterState: this.buildAuditSnapshot(saved),
      metadata: { sourceCampaignId: campaign.id },
    });
    return this.getCampaignDetail(saved.id);
  }

  private async requireCampaign(campaignId: string) {
    const campaign = await this.spotlightRepository.findOne({ where: { id: campaignId } });
    if (!campaign) {
      throw new NotFoundException("Spotlight campaign not found");
    }
    return campaign;
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
      buttonLabel: campaign.buttonLabel ?? null,
      destination: campaign.deepLink ?? null,
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
        albumArt: campaign.albumArt,
        tag: campaign.tag,
        destination: campaign.deepLink ?? null,
        buttonLabel: campaign.buttonLabel ?? null,
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
