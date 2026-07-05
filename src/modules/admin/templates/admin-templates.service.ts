import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  assertCanvasMeta,
  assertTemplateComposition,
  DEFAULT_CANVAS_META,
  normalizeCanvasMeta,
} from "../../../common/composition/composition.utils";
import { AdminAuditLog, Repit, Template, TemplateVersion } from "../../../entities";
import { AdminAuditLogsService } from "../audit-logs/admin-audit-logs.service";
import type { AdminRequestActor, AdminRequestContext } from "../admin.types";
import { AdminListTemplatesQueryDto } from "./dto/admin-list-templates-query.dto";
import { AdminTemplateActionDto } from "./dto/admin-template-action.dto";
import { AdminTemplateRollbackDto } from "./dto/admin-template-rollback.dto";
import { AdminUpdateTemplateDto } from "./dto/admin-update-template.dto";
import { AdminUpsertTemplateDto } from "./dto/admin-upsert-template.dto";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const DEFAULT_TEMPLATE_PREVIEW_BASE = "/images/templates";

@Injectable()
export class AdminTemplatesService {
  constructor(
    @InjectRepository(Template)
    private readonly templateRepository: Repository<Template>,
    @InjectRepository(TemplateVersion)
    private readonly templateVersionRepository: Repository<TemplateVersion>,
    @InjectRepository(AdminAuditLog)
    private readonly auditLogRepository: Repository<AdminAuditLog>,
    @InjectRepository(Repit)
    private readonly repitRepository: Repository<Repit>,
    private readonly auditLogsService: AdminAuditLogsService,
  ) {}

  async listTemplates(query: AdminListTemplatesQueryDto) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(query.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const qb = this.templateRepository.createQueryBuilder("template");
    const search = query.search?.trim() ?? "";

    if (search) {
      qb.andWhere("(template.id ILIKE :search OR template.name ILIKE :search OR template.style ILIKE :search)", {
        search: `%${search}%`,
      });
    }

    if (query.category) {
      qb.andWhere("template.category = :category", { category: query.category });
    }

    if (query.status) {
      qb.andWhere("template.status = :status", { status: query.status });
    }

    if (query.active !== undefined) {
      qb.andWhere("template.isActive = :active", { active: query.active === "true" });
    }

    const total = await qb.getCount();
    const order = query.sortOrder?.toUpperCase() === "ASC" ? "ASC" : "DESC";
    const orderBy = query.sortBy ?? "updatedAt";
    qb.orderBy(`template.${orderBy}`, order).offset((page - 1) * pageSize).limit(pageSize);

    const templates = await qb.getMany();
    const usageCounts = await this.loadUsageCounts(templates.map((template) => template.id));

    return {
      total,
      page,
      pageSize,
      records: templates.map((template) => this.serializeTemplateListItem(template, usageCounts.get(template.id) ?? 0)),
    };
  }

  async getTemplateDetail(templateId: string) {
    const template = await this.requireTemplate(templateId);
    const usageCounts = await this.loadUsageCounts([template.id]);
    const [versions, history] = await Promise.all([
      this.templateVersionRepository.find({
        where: { templateId },
        order: { versionNumber: "DESC", createdAt: "DESC" },
      }),
      this.auditLogRepository.find({
        where: { targetType: "template", targetId: templateId },
        order: { createdAt: "DESC" },
        take: 20,
      }),
    ]);

    return {
      ...this.serializeTemplateDetail(template, usageCounts.get(template.id) ?? 0),
      versions: versions.map((version) => this.serializeVersion(version)),
      history: history.map((log) => this.serializeHistory(log)),
    };
  }

  async createTemplate(dto: AdminUpsertTemplateDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    const existing = await this.templateRepository.findOne({ where: { id: dto.id } });
    if (existing) {
      throw new BadRequestException(`Template \"${dto.id}\" already exists`);
    }

    const composition = dto.composition
      ? assertTemplateComposition(dto.composition, {
        context: "composition",
        templateId: dto.id,
        templateVersion: 1,
        fallbackCanvasMeta: dto.canvasMeta ? assertCanvasMeta(dto.canvasMeta, "canvasMeta") : DEFAULT_CANVAS_META,
      })
      : null;
    const canvasMeta = dto.canvasMeta
      ? assertCanvasMeta(dto.canvasMeta, "canvasMeta")
      : composition?.canvasMeta ?? DEFAULT_CANVAS_META;

    const template = this.templateRepository.create({
      id: dto.id,
      name: dto.name,
      style: dto.style,
      category: dto.category,
      premium: dto.premium ?? false,
      animated: dto.animated ?? false,
      isActive: dto.isActive ?? true,
      sortOrder: dto.sortOrder ?? 0,
      layoutVariant: dto.layoutVariant ?? "classic",
      playerVariant: dto.playerVariant ?? "default",
      overlayOpacity: dto.overlayOpacity ?? 0.3,
      templateVersion: 1,
      status: "draft",
      previewImages: this.normalizePreviewImages(dto.id, dto.previewImages),
      composition,
      canvasMeta,
      capabilities: dto.capabilities ?? null,
      designTokens: dto.designTokens ?? null,
      constraints: dto.constraints ?? null,
      designerNotes: dto.designerNotes ?? null,
      workflow: dto.workflow ?? null,
      certificationMeta: dto.certificationMeta ?? null,
      createdByAdminUserId: actor?.id ?? null,
      createdByAdminEmail: actor?.email ?? null,
      updatedByAdminUserId: actor?.id ?? null,
      updatedByAdminEmail: actor?.email ?? null,
      lastChangeSummary: dto.changeSummary ?? "Initial template creation",
    });

    const saved = await this.templateRepository.save(template);
    await this.appendVersion(saved, "created", dto.changeSummary ?? "Initial template creation", actor);
    await this.auditLogsService.append({
      action: "admin.templates.created",
      actor,
      context,
      targetType: "template",
      targetId: saved.id,
      afterState: this.buildTemplateAuditSnapshot(saved),
    });

    return this.getTemplateDetail(saved.id);
  }

  async updateTemplate(templateId: string, dto: AdminUpdateTemplateDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    const template = await this.requireTemplate(templateId);
    const beforeState = this.buildTemplateAuditSnapshot(template);
    const nextVersion = template.templateVersion + 1;
    const validatedCanvasMeta = dto.canvasMeta !== undefined ? assertCanvasMeta(dto.canvasMeta, "canvasMeta") : undefined;
    const validatedComposition = dto.composition !== undefined
      ? assertTemplateComposition(dto.composition, {
        context: "composition",
        templateId: template.id,
        templateVersion: nextVersion,
        fallbackCanvasMeta: validatedCanvasMeta ?? normalizeCanvasMeta(template.canvasMeta, DEFAULT_CANVAS_META),
      })
      : undefined;

    Object.assign(template, {
      name: dto.name ?? template.name,
      style: dto.style ?? template.style,
      category: dto.category ?? template.category,
      premium: dto.premium ?? template.premium,
      animated: dto.animated ?? template.animated,
      isActive: dto.isActive ?? template.isActive,
      sortOrder: dto.sortOrder ?? template.sortOrder,
      layoutVariant: dto.layoutVariant ?? template.layoutVariant,
      playerVariant: dto.playerVariant ?? template.playerVariant,
      overlayOpacity: dto.overlayOpacity ?? template.overlayOpacity,
      previewImages: dto.previewImages !== undefined ? this.normalizePreviewImages(template.id, dto.previewImages) : template.previewImages,
      canvasMeta: validatedComposition?.canvasMeta ?? validatedCanvasMeta ?? template.canvasMeta,
      composition: validatedComposition ?? template.composition,
      capabilities: dto.capabilities !== undefined ? dto.capabilities : template.capabilities,
      designTokens: dto.designTokens !== undefined ? dto.designTokens : template.designTokens,
      constraints: dto.constraints !== undefined ? dto.constraints : template.constraints,
      designerNotes: dto.designerNotes !== undefined ? dto.designerNotes : template.designerNotes,
      workflow: dto.workflow !== undefined ? dto.workflow : template.workflow,
      certificationMeta: dto.certificationMeta !== undefined ? dto.certificationMeta : template.certificationMeta,
      templateVersion: nextVersion,
      updatedByAdminUserId: actor?.id ?? null,
      updatedByAdminEmail: actor?.email ?? null,
      lastChangeSummary: dto.changeSummary ?? "Template updated",
    });

    const saved = await this.templateRepository.save(template);
    await this.appendVersion(saved, "updated", dto.changeSummary ?? "Template updated", actor);
    await this.auditLogsService.append({
      action: "admin.templates.updated",
      actor,
      context,
      targetType: "template",
      targetId: saved.id,
      beforeState,
      afterState: this.buildTemplateAuditSnapshot(saved),
      metadata: { versionNumber: saved.templateVersion, summary: dto.changeSummary ?? "Template updated" },
    });

    return this.getTemplateDetail(saved.id);
  }

  async publishTemplate(templateId: string, dto: AdminTemplateActionDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    const template = await this.requireTemplate(templateId);
    const beforeState = this.buildTemplateAuditSnapshot(template);
    template.status = "published";
    template.publishedAt = new Date();
    template.archivedAt = null;
    template.templateVersion += 1;
    template.updatedByAdminUserId = actor?.id ?? null;
    template.updatedByAdminEmail = actor?.email ?? null;
    template.lastChangeSummary = dto.summary ?? "Template published";
    const saved = await this.templateRepository.save(template);
    await this.appendVersion(saved, "published", dto.summary ?? "Template published", actor, true);
    await this.auditLogsService.append({
      action: "admin.templates.published",
      actor,
      context,
      targetType: "template",
      targetId: saved.id,
      beforeState,
      afterState: this.buildTemplateAuditSnapshot(saved),
      metadata: { versionNumber: saved.templateVersion, summary: dto.summary ?? "Template published" },
    });
    return this.getTemplateDetail(saved.id);
  }

  async archiveTemplate(templateId: string, dto: AdminTemplateActionDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    const template = await this.requireTemplate(templateId);
    const beforeState = this.buildTemplateAuditSnapshot(template);
    template.status = "archived";
    template.isActive = false;
    template.archivedAt = new Date();
    template.updatedByAdminUserId = actor?.id ?? null;
    template.updatedByAdminEmail = actor?.email ?? null;
    template.lastChangeSummary = dto.summary ?? "Template archived";
    const saved = await this.templateRepository.save(template);
    await this.appendVersion(saved, "archived", dto.summary ?? "Template archived", actor, saved.status === "published");
    await this.auditLogsService.append({
      action: "admin.templates.archived",
      actor,
      context,
      targetType: "template",
      targetId: saved.id,
      beforeState,
      afterState: this.buildTemplateAuditSnapshot(saved),
      metadata: { summary: dto.summary ?? "Template archived" },
    });
    return this.getTemplateDetail(saved.id);
  }

  async rollbackTemplate(templateId: string, dto: AdminTemplateRollbackDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    const template = await this.requireTemplate(templateId);
    const targetVersion = await this.templateVersionRepository.findOne({
      where: { templateId, versionNumber: dto.versionNumber },
    });
    if (!targetVersion) {
      throw new NotFoundException(`Template version ${dto.versionNumber} not found`);
    }

    const beforeState = this.buildTemplateAuditSnapshot(template);
    const snapshot = targetVersion.snapshot as Record<string, any>;
    template.name = snapshot.name;
    template.style = snapshot.style;
    template.category = snapshot.category;
    template.premium = snapshot.premium;
    template.animated = snapshot.animated;
    template.isActive = snapshot.isActive;
    template.sortOrder = snapshot.sortOrder;
    template.layoutVariant = snapshot.layoutVariant;
    template.playerVariant = snapshot.playerVariant;
    template.overlayOpacity = snapshot.overlayOpacity;
    template.status = snapshot.status;
    template.previewImages = snapshot.previewImages ?? this.normalizePreviewImages(template.id, null);
    template.canvasMeta = snapshot.canvasMeta ?? template.canvasMeta;
    template.composition = snapshot.composition ?? template.composition;
    template.capabilities = snapshot.capabilities ?? template.capabilities;
    template.designTokens = snapshot.designTokens ?? template.designTokens;
    template.constraints = snapshot.constraints ?? template.constraints;
    template.designerNotes = snapshot.designerNotes ?? template.designerNotes;
    template.workflow = snapshot.workflow ?? template.workflow;
    template.certificationMeta = snapshot.certificationMeta ?? template.certificationMeta;
    template.publishedAt = snapshot.publishedAt ? new Date(snapshot.publishedAt) : template.publishedAt;
    template.archivedAt = snapshot.archivedAt ? new Date(snapshot.archivedAt) : null;
    template.templateVersion += 1;
    template.updatedByAdminUserId = actor?.id ?? null;
    template.updatedByAdminEmail = actor?.email ?? null;
    template.lastChangeSummary = dto.summary ?? `Rolled back to version ${dto.versionNumber}`;

    const saved = await this.templateRepository.save(template);
    await this.appendVersion(saved, "rollback", dto.summary ?? `Rolled back to version ${dto.versionNumber}`, actor, targetVersion.published);
    await this.auditLogsService.append({
      action: "admin.templates.rollback",
      actor,
      context,
      targetType: "template",
      targetId: saved.id,
      beforeState,
      afterState: this.buildTemplateAuditSnapshot(saved),
      metadata: { rolledBackToVersion: dto.versionNumber, summary: dto.summary ?? `Rolled back to version ${dto.versionNumber}` },
    });

    return this.getTemplateDetail(saved.id);
  }

  async listVersions(templateId: string) {
    await this.requireTemplate(templateId);
    const versions = await this.templateVersionRepository.find({
      where: { templateId },
      order: { versionNumber: "DESC", createdAt: "DESC" },
    });
    return { total: versions.length, records: versions.map((version) => this.serializeVersion(version)) };
  }

  async listHistory(templateId: string) {
    await this.requireTemplate(templateId);
    const history = await this.auditLogRepository.find({
      where: { targetType: "template", targetId: templateId },
      order: { createdAt: "DESC" },
    });
    return { total: history.length, records: history.map((log) => this.serializeHistory(log)) };
  }

  private async requireTemplate(templateId: string) {
    const template = await this.templateRepository.findOne({ where: { id: templateId } });
    if (!template) {
      throw new NotFoundException("Template not found");
    }
    return template;
  }

  private async loadUsageCounts(templateIds: string[]) {
    const map = new Map<string, number>();
    if (!templateIds.length) return map;
    const rows = await this.repitRepository
      .createQueryBuilder("repit")
      .select("repit.templateId", "templateId")
      .addSelect("COUNT(repit.id)", "usageCount")
      .where("repit.templateId IN (:...templateIds)", { templateIds })
      .groupBy("repit.templateId")
      .getRawMany<Record<string, string>>();
    for (const row of rows) {
      map.set(String(row.templateId), Number(row.usageCount ?? 0));
    }
    return map;
  }

  private buildLayoutSummary(template: Template) {
    const layers = Array.isArray(template.composition?.layers) ? template.composition.layers : [];
    const widgetTypes = Array.from(new Set(layers.filter((layer: any) => layer?.type).map((layer: any) => layer.type)));
    return {
      layerCount: layers.length,
      musicWidgetCount: layers.filter((layer: any) => layer?.type === "musicWidget").length,
      photoLayerCount: layers.filter((layer: any) => layer?.type === "photo").length,
      textLayerCount: layers.filter((layer: any) => layer?.type === "text" || layer?.type === "lyricsText").length,
      widgetTypes,
    };
  }

  private serializeTemplateListItem(template: Template, usageCount: number) {
    const summary = this.buildLayoutSummary(template);
    return {
      id: template.id,
      name: template.name,
      style: template.style,
      category: template.category,
      status: template.status,
      isActive: template.isActive,
      premium: template.premium,
      animated: template.animated,
      sortOrder: template.sortOrder,
      currentVersion: template.templateVersion,
      updatedAt: template.updatedAt,
      createdAt: template.createdAt,
      usageCount,
      previewImages: this.normalizePreviewImages(template.id, template.previewImages),
      widgetTypes: summary.widgetTypes,
      layoutSummary: summary,
    };
  }

  private serializeTemplateDetail(template: Template, usageCount: number) {
    const summary = this.buildLayoutSummary(template);
    return {
      id: template.id,
      name: template.name,
      style: template.style,
      category: template.category,
      status: template.status,
      isActive: template.isActive,
      premium: template.premium,
      animated: template.animated,
      sortOrder: template.sortOrder,
      layoutVariant: template.layoutVariant,
      playerVariant: template.playerVariant,
      overlayOpacity: template.overlayOpacity,
      currentVersion: template.templateVersion,
      canvasMeta: template.canvasMeta ?? null,
      composition: template.composition ?? null,
      previewImages: this.normalizePreviewImages(template.id, template.previewImages),
      widgetTypes: summary.widgetTypes,
      layoutSummary: summary,
      capabilities: template.capabilities ?? null,
      designTokens: template.designTokens ?? null,
      constraints: template.constraints ?? null,
      designerNotes: template.designerNotes ?? null,
      workflow: template.workflow ?? null,
      certificationMeta: template.certificationMeta ?? null,
      usageCount,
      popularityRank: null,
      conversionRate: null,
      creator: template.createdByAdminEmail ? { id: template.createdByAdminUserId ?? null, email: template.createdByAdminEmail } : null,
      lastEditor: template.updatedByAdminEmail ? { id: template.updatedByAdminUserId ?? null, email: template.updatedByAdminEmail } : null,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
      publishedAt: template.publishedAt ?? null,
      archivedAt: template.archivedAt ?? null,
      lastChangeSummary: template.lastChangeSummary ?? null,
    };
  }

  private serializeVersion(version: TemplateVersion) {
    const snapshot = version.snapshot as Record<string, any>;
    return {
      id: version.id,
      versionNumber: version.versionNumber,
      author: version.authorEmail ?? null,
      createdAt: version.createdAt,
      summary: version.summary ?? null,
      published: version.published,
      action: version.action,
      previewImages: Array.isArray(snapshot.previewImages) ? snapshot.previewImages : [],
      status: snapshot.status ?? null,
    };
  }

  private serializeHistory(log: AdminAuditLog) {
    return {
      id: log.id,
      action: log.action,
      actorEmail: log.actorEmail ?? null,
      createdAt: log.createdAt,
      metadata: log.metadata ?? null,
    };
  }

  private normalizePreviewImages(templateId: string, previewImages?: string[] | null) {
    if (previewImages && previewImages.length) return previewImages;
    return [`${DEFAULT_TEMPLATE_PREVIEW_BASE}/preview-${templateId}.webp`];
  }

  private buildTemplateAuditSnapshot(template: Template) {
    return {
      id: template.id,
      name: template.name,
      style: template.style,
      category: template.category,
      status: template.status,
      isActive: template.isActive,
      premium: template.premium,
      animated: template.animated,
      sortOrder: template.sortOrder,
      templateVersion: template.templateVersion,
      layoutVariant: template.layoutVariant,
      playerVariant: template.playerVariant,
      overlayOpacity: template.overlayOpacity,
      previewImages: this.normalizePreviewImages(template.id, template.previewImages),
      canvasMeta: template.canvasMeta ?? null,
      composition: template.composition ?? null,
      capabilities: template.capabilities ?? null,
      designTokens: template.designTokens ?? null,
      constraints: template.constraints ?? null,
      designerNotes: template.designerNotes ?? null,
      workflow: template.workflow ?? null,
      certificationMeta: template.certificationMeta ?? null,
      publishedAt: template.publishedAt?.toISOString?.() ?? null,
      archivedAt: template.archivedAt?.toISOString?.() ?? null,
    };
  }

  private async appendVersion(template: Template, action: TemplateVersion["action"], summary: string, actor?: AdminRequestActor | null, published?: boolean) {
    const version = this.templateVersionRepository.create({
      templateId: template.id,
      versionNumber: template.templateVersion,
      action,
      summary,
      published: published ?? template.status === "published",
      authorAdminUserId: actor?.id ?? null,
      authorEmail: actor?.email ?? null,
      snapshot: this.buildTemplateAuditSnapshot(template),
    });
    await this.templateVersionRepository.save(version);
  }
}
