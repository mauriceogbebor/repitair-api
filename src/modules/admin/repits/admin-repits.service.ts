import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Repit } from "../../../entities/repit.entity";
import { Template } from "../../../entities/template.entity";
import { User } from "../../../entities/user.entity";
import { AdminAuditLogsService } from "../audit-logs/admin-audit-logs.service";
import type { AdminRequestActor, AdminRequestContext } from "../admin.types";
import { AdminArchiveRepitDto } from "./dto/admin-archive-repit.dto";
import { AdminFlagRepitDto } from "./dto/admin-flag-repit.dto";
import { AdminListRepitsQueryDto } from "./dto/admin-list-repits-query.dto";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function normalizeDateInput(value?: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

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
  ) {}

  async listRepits(query: AdminListRepitsQueryDto) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(query.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const search = query.search?.trim() ?? "";
    const dateFrom = normalizeDateInput(query.dateFrom);
    const dateTo = normalizeDateInput(query.dateTo);

    if ((query.dateFrom && !dateFrom) || (query.dateTo && !dateTo)) {
      throw new BadRequestException("Invalid repit date filter");
    }

    const countQb = this.repitRepository
      .createQueryBuilder("repit")
      .leftJoin("repit.user", "user")
      .leftJoin("repit.template", "template");
    this.applyRepitFilters(countQb, { search, ...query, dateFrom, dateTo });
    const total = await countQb.getCount();

    const qb = this.repitRepository
      .createQueryBuilder("repit")
      .leftJoinAndSelect("repit.user", "user")
      .leftJoinAndSelect("repit.template", "template");

    this.applyRepitFilters(qb, { search, ...query, dateFrom, dateTo });
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
          ? { id: repit.user.id, fullName: repit.user.fullName, email: repit.user.email }
          : { id: repit.userId, fullName: "Unknown user", email: "" },
        backgroundPhotoUrl: repit.backgroundPhotoUrl ?? null,
        createdAt: repit.createdAt,
      })),
    };
  }

  async getRepitDetail(repitId: string) {
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
        ? { id: repit.user.id, fullName: repit.user.fullName, email: repit.user.email }
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

  async flagRepit(
    repitId: string,
    dto: AdminFlagRepitDto,
    actor?: AdminRequestActor | null,
    context?: AdminRequestContext | null,
  ) {
    const repit = await this.requireRepit(repitId);
    const beforeState = this.buildRepitAuditSnapshot(repit);
    repit.moderationStatus = "flagged";
    repit.flagReason = dto.reason;
    const saved = await this.repitRepository.save(repit);

    await this.auditLogsService.append({
      action: "admin.repits.flagged",
      actor,
      context,
      targetType: "repit",
      targetId: repit.id,
      beforeState,
      afterState: this.buildRepitAuditSnapshot(saved),
      metadata: { reason: dto.reason },
    });

    return this.getRepitDetail(saved.id);
  }

  async archiveRepit(
    repitId: string,
    dto: AdminArchiveRepitDto,
    actor?: AdminRequestActor | null,
    context?: AdminRequestContext | null,
  ) {
    const repit = await this.requireRepit(repitId);
    const beforeState = this.buildRepitAuditSnapshot(repit);
    repit.moderationStatus = "archived";
    repit.archivedAt = new Date();
    if (dto.reason) {
      repit.flagReason = dto.reason;
    }
    const saved = await this.repitRepository.save(repit);

    await this.auditLogsService.append({
      action: "admin.repits.archived",
      actor,
      context,
      targetType: "repit",
      targetId: repit.id,
      beforeState,
      afterState: this.buildRepitAuditSnapshot(saved),
      metadata: dto.reason ? { reason: dto.reason } : null,
    });

    return this.getRepitDetail(saved.id);
  }

  async deleteRepit(repitId: string, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    const repit = await this.requireRepit(repitId);
    const beforeState = this.buildRepitAuditSnapshot(repit);
    repit.moderationStatus = "deleted";
    repit.deletedByAdminAt = new Date();
    const saved = await this.repitRepository.save(repit);

    await this.auditLogsService.append({
      action: "admin.repits.deleted",
      actor,
      context,
      targetType: "repit",
      targetId: repit.id,
      beforeState,
      afterState: this.buildRepitAuditSnapshot(saved),
    });

    return { success: true, repitId: saved.id };
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
      dateFrom?: Date | null;
      dateTo?: Date | null;
    },
  ) {
    if (filters.search) {
      qb.andWhere(
        "(repit.id::text ILIKE :search OR repit.title ILIKE :search OR COALESCE(repit.artist, '') ILIKE :search OR user.email ILIKE :search OR user.fullName ILIKE :search OR template.name ILIKE :search)",
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

    if (filters.dateFrom) {
      qb.andWhere("repit.createdAt >= :dateFrom", { dateFrom: filters.dateFrom.toISOString() });
    }

    if (filters.dateTo) {
      qb.andWhere("repit.createdAt <= :dateTo", { dateTo: filters.dateTo.toISOString() });
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

  private buildRepitAuditSnapshot(repit: Repit) {
    return {
      id: repit.id,
      title: repit.title,
      status: repit.status,
      moderationStatus: repit.moderationStatus,
      flagReason: repit.flagReason ?? null,
      archivedAt: repit.archivedAt?.toISOString?.() ?? null,
      deletedByAdminAt: repit.deletedByAdminAt?.toISOString?.() ?? null,
      templateId: repit.templateId,
      userId: repit.userId,
    };
  }
}
