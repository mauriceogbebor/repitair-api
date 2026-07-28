import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Repit } from "../../../entities/repit.entity";
import { Template } from "../../../entities/template.entity";
import { User } from "../../../entities/user.entity";
import { AdminAuditLogsService } from "../audit-logs/admin-audit-logs.service";
import type { AdminRequestActor, AdminRequestContext } from "../admin.types";
import { createCsv } from "../utils/csv";
import { resolveDateRange } from "../utils/date-range";
import { AdminArchiveRepitDto } from "./dto/admin-archive-repit.dto";
import { AdminFlagRepitDto } from "./dto/admin-flag-repit.dto";
import { AdminListRepitsQueryDto } from "./dto/admin-list-repits-query.dto";
import { AdminRepitModerationService } from "./admin-repit-moderation.service";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const EXPORT_LIMIT = 10_000;

@Injectable()
export class AdminRepitsService {
  constructor(
    @InjectRepository(Repit)
    private readonly repitRepository: Repository<Repit>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Template)
    private readonly templateRepository: Repository<Template>,
    private readonly auditLogsService: AdminAuditLogsService,
    private readonly moderationService: AdminRepitModerationService,
  ) {}

  async listRepits(query: AdminListRepitsQueryDto, actor?: AdminRequestActor | null) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(query.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const search = query.search?.trim() ?? "";
    const { start: dateFrom, endExclusive: dateToExclusive } = resolveDateRange(query.dateFrom, query.dateTo, "repit");

    const countQb = this.repitRepository
      .createQueryBuilder("repit")
      .leftJoin("repit.user", "user")
      .leftJoin("repit.template", "template");
    const includePii = Boolean(actor?.permissionKeys?.includes("users.read_pii"));
    this.applyRepitFilters(countQb, { search, ...query, dateFrom, dateToExclusive, includePii });
    const total = await countQb.getCount();

    const qb = this.repitRepository
      .createQueryBuilder("repit")
      .leftJoinAndSelect("repit.user", "user")
      .leftJoinAndSelect("repit.template", "template");

    this.applyRepitFilters(qb, { search, ...query, dateFrom, dateToExclusive, includePii });
    this.applyRepitSorting(qb, query.sortBy, query.sortOrder);
    qb.offset((page - 1) * pageSize).limit(pageSize);

    const repits = await qb.getMany();

    return {
      total,
      page,
      pageSize,
      records: repits.map((repit) => ({
        id: repit.id,
        title: repit.title,
        artist: repit.artist ?? null,
        status: repit.status,
        moderationStatus: repit.moderationStatus,
        template: {
          id: repit.templateId,
          name: repit.template?.name ?? repit.templateId,
        },
        user: repit.user
          ? { id: repit.user.id, fullName: repit.user.fullName, email: includePii ? repit.user.email : null }
          : { id: repit.userId, fullName: "Unknown user", email: null },
        backgroundPhotoUrl: repit.backgroundPhotoUrl ?? null,
        createdAt: repit.createdAt,
      })),
    };
  }

  async getRepitDetail(repitId: string, actor?: AdminRequestActor | null) {
    const repit = await this.repitRepository.findOne({
      where: { id: repitId },
      relations: { user: true, template: true },
    });

    if (!repit) {
      throw new NotFoundException("Repit not found");
    }

    return {
      id: repit.id,
      title: repit.title,
      songTitle: repit.title,
      artist: repit.artist ?? null,
      songLink: repit.songLink,
      albumArt: repit.albumArt ?? null,
      platform: repit.platform,
      durationMs: repit.durationMs ?? null,
      status: repit.status,
      moderationStatus: repit.moderationStatus,
      moderationReason: repit.flagReason ?? null,
      template: repit.template
        ? { id: repit.template.id, name: repit.template.name, style: repit.template.style }
        : { id: repit.templateId, name: repit.templateId, style: "unknown" },
      user: repit.user
        ? { id: repit.user.id, fullName: repit.user.fullName, email: actor?.permissionKeys?.includes("users.read_pii") ? repit.user.email : null }
        : null,
      backgroundPhotoUrl: repit.backgroundPhotoUrl ?? null,
      compositionSummary: this.buildCompositionSummary(repit),
      createdAt: repit.createdAt,
      updatedAt: repit.updatedAt,
      archivedAt: repit.archivedAt ?? null,
      deletedByAdminAt: repit.deletedByAdminAt ?? null,
      selectedSongs: repit.selectedSongs ?? [],
    };
  }

  async exportRepits(
    query: AdminListRepitsQueryDto,
    actor?: AdminRequestActor | null,
    context?: AdminRequestContext | null,
  ) {
    const search = query.search?.trim() ?? "";
    const { start: dateFrom, endExclusive: dateToExclusive } = resolveDateRange(query.dateFrom, query.dateTo, "repit");
    const includePii = Boolean(actor?.permissionKeys?.includes("users.read_pii"));

    const qb = this.repitRepository
      .createQueryBuilder("repit")
      .leftJoinAndSelect("repit.user", "user")
      .leftJoinAndSelect("repit.template", "template");
    this.applyRepitFilters(qb, { search, ...query, dateFrom, dateToExclusive, includePii });
    this.applyRepitSorting(qb, query.sortBy, query.sortOrder);
    qb.limit(EXPORT_LIMIT + 1);

    const rows = await qb.getMany();
    const truncated = rows.length > EXPORT_LIMIT;
    const records = rows.slice(0, EXPORT_LIMIT);
    const csv = createCsv(
      ["Repit ID", "Title", "Artist", "Status", "Moderation status", "Template ID", "Template name", "User ID", "User name", "User email", "Created"],
      records.map((repit) => [
        repit.id,
        repit.title,
        repit.artist,
        repit.status,
        repit.moderationStatus,
        repit.templateId,
        repit.template?.name ?? repit.templateId,
        repit.userId,
        repit.user?.fullName ?? "Unknown user",
        includePii ? repit.user?.email ?? "" : "",
        repit.createdAt,
      ]),
    );
    const { page: _page, pageSize: _pageSize, ...filters } = query;

    await this.auditLogsService.append({
      action: "admin.repits.exported",
      actor,
      context,
      targetType: "repit-export",
      metadata: { filters, resultCount: records.length, truncated, limit: EXPORT_LIMIT },
    });

    return {
      csv,
      filename: `repitair-repits-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`,
      resultCount: records.length,
      truncated,
      limit: EXPORT_LIMIT,
    };
  }

  async flagRepit(
    repitId: string,
    dto: AdminFlagRepitDto,
    actor?: AdminRequestActor | null,
    context?: AdminRequestContext | null,
  ) {
    await this.moderationService.openReport(repitId, { reason: dto.reason }, actor, context);
    return this.getRepitDetail(repitId, actor);
  }

  async archiveRepit(
    repitId: string,
    dto: AdminArchiveRepitDto,
    actor?: AdminRequestActor | null,
    context?: AdminRequestContext | null,
  ) {
    const report = await this.moderationService.openReport(repitId, { reason: dto.reason }, actor, context);
    await this.moderationService.decide(repitId, {
      reportId: report.id,
      action: "archive",
      reason: dto.reason,
      policyKey: "content.other",
      idempotencyKey: context?.requestId ? `legacy-archive-${context.requestId}` : undefined,
    }, actor, context);
    return this.getRepitDetail(repitId, actor);
  }

  async deleteRepit(repitId: string, dto: AdminFlagRepitDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    const report = await this.moderationService.openReport(repitId, { reason: dto.reason }, actor, context);
    await this.moderationService.decide(repitId, {
      reportId: report.id,
      action: "remove",
      reason: dto.reason,
      policyKey: "content.other",
      idempotencyKey: context?.requestId ? `legacy-remove-${context.requestId}` : undefined,
    }, actor, context);
    return { success: true, repitId };
  }

  private async requireRepit(repitId: string) {
    const repit = await this.repitRepository.findOne({ where: { id: repitId }, relations: { user: true, template: true } });
    if (!repit) {
      throw new NotFoundException("Repit not found");
    }
    return repit;
  }

  private applyRepitFilters(
    qb: ReturnType<Repository<Repit>["createQueryBuilder"]>,
    filters: {
      search?: string;
      userId?: string;
      templateId?: string;
      status?: string;
      publicationStatus?: string;
      includePii?: boolean;
      dateFrom?: Date | null;
      dateToExclusive?: Date | null;
    },
  ) {
    if (filters.search) {
      qb.andWhere(
        filters.includePii
          ? "(repit.id::text ILIKE :search OR repit.title ILIKE :search OR COALESCE(repit.artist, '') ILIKE :search OR user.email ILIKE :search OR user.fullName ILIKE :search OR template.name ILIKE :search)"
          : "(repit.id::text ILIKE :search OR repit.title ILIKE :search OR COALESCE(repit.artist, '') ILIKE :search OR user.fullName ILIKE :search OR template.name ILIKE :search)",
        { search: `%${filters.search}%` },
      );
    }

    if (filters.userId) {
      qb.andWhere("repit.userId = :userId", { userId: filters.userId });
    }

    if (filters.templateId) {
      qb.andWhere("repit.templateId = :templateId", { templateId: filters.templateId });
    }

    if (filters.status) {
      qb.andWhere("repit.moderationStatus = :status", { status: filters.status });
    }

    if (filters.publicationStatus) {
      qb.andWhere("repit.status = :publicationStatus", { publicationStatus: filters.publicationStatus });
    }

    if (filters.dateFrom) {
      qb.andWhere("repit.createdAt >= :dateFrom", { dateFrom: filters.dateFrom.toISOString() });
    }

    if (filters.dateToExclusive) {
      qb.andWhere("repit.createdAt < :dateToExclusive", { dateToExclusive: filters.dateToExclusive.toISOString() });
    }
  }

  private applyRepitSorting(
    qb: ReturnType<Repository<Repit>["createQueryBuilder"]>,
    sortBy?: string,
    sortOrder?: string,
  ) {
    const order = sortOrder?.toUpperCase() === "ASC" ? "ASC" : "DESC";
    switch (sortBy) {
      case "title":
        qb.orderBy("repit.title", order);
        break;
      case "status":
        qb.orderBy("repit.moderationStatus", order);
        break;
      case "templateName":
        qb.orderBy("template.name", order);
        break;
      case "userName":
        qb.orderBy("user.fullName", order);
        break;
      default:
        qb.orderBy("repit.createdAt", order);
        break;
    }
  }

  private buildCompositionSummary(repit: Repit) {
    const layers = Array.isArray(repit.composition?.layers) ? repit.composition.layers : [];
    return {
      templateVersion: repit.templateVersion,
      canvasMeta: repit.canvasMeta ?? repit.composition?.canvasMeta ?? null,
      layerCount: layers.length,
      musicWidgetCount: layers.filter((layer) => layer?.type === "musicWidget").length,
      lyricsLayerCount: layers.filter((layer) => layer?.type === "lyricsText").length,
      photoLayerCount: layers.filter((layer) => layer?.type === "photo").length,
      selectedSongCount: repit.selectedSongs?.length ?? 0,
    };
  }

}
