import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, EntityManager, In, Repository } from "typeorm";
import {
  assertCanvasMeta,
  assertTemplateComposition,
  DEFAULT_CANVAS_META,
  normalizeCanvasMeta,
} from "../../../common/composition/composition.utils";
import { AdminAuditLog, Repit, Template, TemplateDraft, TemplateVersion } from "../../../entities";
import { AdminAuditLogsService } from "../audit-logs/admin-audit-logs.service";
import type { AdminRequestActor, AdminRequestContext } from "../admin.types";
import { AdminListTemplatesQueryDto } from "./dto/admin-list-templates-query.dto";
import { AdminTemplateActionDto } from "./dto/admin-template-action.dto";
import { AdminTemplateCertifyDto } from "./dto/admin-template-certify.dto";
import { AdminTemplateRollbackDto } from "./dto/admin-template-rollback.dto";
import { AdminUpdateTemplateDto } from "./dto/admin-update-template.dto";
import { AdminUpsertTemplateDto } from "./dto/admin-upsert-template.dto";
import { isolationCapabilityError } from "../../media/template-media-capability";
import type { TemplateCapabilities, TemplateCertificationMeta } from "../../../common/template-metadata/template-metadata.types";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const DEFAULT_TEMPLATE_PREVIEW_BASE = "/images/templates";
const TEMPLATE_DRAFT_FIELDS: Array<keyof Template> = [
  "name",
  "style",
  "category",
  "premium",
  "animated",
  "isActive",
  "sortOrder",
  "layoutVariant",
  "playerVariant",
  "overlayOpacity",
  "previewImages",
  "canvasMeta",
  "composition",
  "capabilities",
  "designTokens",
  "constraints",
  "designerNotes",
  "workflow",
  "certificationMeta",
];

@Injectable()
export class AdminTemplatesService {
  constructor(
    @InjectRepository(Template)
    private readonly templateRepository: Repository<Template>,
    @InjectRepository(TemplateVersion)
    private readonly templateVersionRepository: Repository<TemplateVersion>,
    @InjectRepository(TemplateDraft)
    private readonly templateDraftRepository: Repository<TemplateDraft>,
    @InjectRepository(AdminAuditLog)
    private readonly auditLogRepository: Repository<AdminAuditLog>,
    @InjectRepository(Repit)
    private readonly repitRepository: Repository<Repit>,
    private readonly dataSource: DataSource,
    private readonly auditLogsService: AdminAuditLogsService,
  ) {}

  /**
   * Guardrail: a template may only require background removal if its composition
   * declares an isolated-subject treatment. Prevents enabling AI processing on a
   * full-bleed template (provider cost with no design benefit).
   */
  private assertIsolationConsistent(capabilities?: TemplateCapabilities | null): void {
    const error = isolationCapabilityError(capabilities);
    if (error) throw new BadRequestException(error);
  }

  /** Certification levels that gate publication — reachable ONLY via the
   *  certify endpoint (permission `templates.certify`), never the write path. */
  private static readonly ELEVATED_CERTIFICATION: ReadonlySet<string> = new Set(["approved", "certified"]);

  /**
   * Separation of duties: the ordinary write path (`templates.write`) must not be
   * able to elevate a template's certification to an approved/certified state —
   * otherwise an author could self-certify and publish their own draft. Any
   * attempt to set an elevated status through create/update is reverted to the
   * last non-elevated status; all other certification fields are preserved.
   */
  private sanitizeCertificationForWritePath(
    next: TemplateCertificationMeta | null | undefined,
    current: TemplateCertificationMeta | null | undefined,
  ): TemplateCertificationMeta | null {
    if (next === null || next === undefined) return next ?? null;
    if (next.status && AdminTemplatesService.ELEVATED_CERTIFICATION.has(next.status)) {
      const fallback = current?.status && !AdminTemplatesService.ELEVATED_CERTIFICATION.has(current.status)
        ? current.status
        : "product-review";
      return { ...next, status: fallback };
    }
    return next;
  }

  private getPublicationReadiness(template: Template) {
    const blockers: string[] = [];
    const warnings: string[] = [];

    if (!template.isActive) blockers.push("Template must be active before publishing");
    if (!template.composition) {
      blockers.push("A validated server composition is required");
    } else {
      try {
        assertTemplateComposition(template.composition, {
          context: "composition",
          templateId: template.id,
          templateVersion: template.templateVersion,
          fallbackCanvasMeta: normalizeCanvasMeta(template.canvasMeta, DEFAULT_CANVAS_META),
        });
      } catch (error) {
        blockers.push(error instanceof Error ? error.message : "Composition is invalid");
      }
    }

    if (!Array.isArray(template.previewImages) || template.previewImages.length === 0) {
      blockers.push("At least one preview image is required");
    }

    try {
      this.assertIsolationConsistent(template.capabilities);
    } catch (error) {
      blockers.push(error instanceof Error ? error.message : "Template capabilities are inconsistent");
    }

    const certificationStatus = template.certificationMeta?.status;
    if (!certificationStatus || !["approved", "certified", "published"].includes(certificationStatus)) {
      blockers.push("Certification status must be approved or certified");
    }
    if (!template.workflow?.steps?.length) warnings.push("Workflow is auto-derived from capabilities");

    return { ready: blockers.length === 0, blockers, warnings };
  }

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
    const templateIds = templates.map((template) => template.id);
    const [usageCounts, drafts] = await Promise.all([
      this.loadUsageCounts(templateIds),
      templateIds.length
        ? this.templateDraftRepository.find({ where: { templateId: In(templateIds) } })
        : Promise.resolve([]),
    ]);
    const draftsByTemplateId = new Map(drafts.map((draft) => [draft.templateId, draft]));

    return {
      total,
      page,
      pageSize,
      records: templates.map((template) => this.serializeTemplateListItem(
        template,
        usageCounts.get(template.id) ?? 0,
        draftsByTemplateId.get(template.id) ?? null,
      )),
    };
  }

  async getTemplateDetail(templateId: string) {
    const template = await this.requireTemplate(templateId);
    const usageCounts = await this.loadUsageCounts([template.id]);
    const [versions, history, draft] = await Promise.all([
      this.templateVersionRepository.find({
        where: { templateId },
        order: { versionNumber: "DESC", createdAt: "DESC" },
      }),
      this.auditLogRepository.find({
        where: { targetType: "template", targetId: templateId },
        order: { createdAt: "DESC" },
        take: 20,
      }),
      this.templateDraftRepository.findOne({ where: { templateId } }),
    ]);

    return {
      ...this.serializeTemplateDetail(template, usageCounts.get(template.id) ?? 0, draft),
      versions: versions.map((version) => this.serializeVersion(version)),
      history: history.map((log) => this.serializeHistory(log)),
    };
  }

  async createTemplate(dto: AdminUpsertTemplateDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
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

    const savedId = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Template);
      const existing = await repository.findOne({ where: { id: dto.id } });
      if (existing) throw new BadRequestException(`Template \"${dto.id}\" already exists`);

      const template = repository.create({
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
        previewImages: dto.previewImages?.length ? dto.previewImages : null,
        composition,
        canvasMeta,
        capabilities: dto.capabilities ?? null,
        designTokens: dto.designTokens ?? null,
        constraints: dto.constraints ?? null,
        designerNotes: dto.designerNotes ?? null,
        workflow: dto.workflow ?? null,
        certificationMeta: this.sanitizeCertificationForWritePath(dto.certificationMeta ?? null, null),
        createdByAdminUserId: actor?.id ?? null,
        createdByAdminEmail: actor?.email ?? null,
        updatedByAdminUserId: actor?.id ?? null,
        updatedByAdminEmail: actor?.email ?? null,
        lastChangeSummary: dto.changeSummary ?? "Initial template creation",
      });

      this.assertIsolationConsistent(template.capabilities);
      const saved = await repository.save(template);
      const draftRepository = manager.getRepository(TemplateDraft);
      const draft = draftRepository.create({
        templateId: saved.id,
        basedOnVersion: saved.templateVersion,
        revision: 1,
        snapshot: this.buildTemplateDraftSnapshot(saved),
        authorAdminUserId: actor?.id ?? null,
        authorEmail: actor?.email ?? null,
        summary: dto.changeSummary ?? "Initial template creation",
      });
      await draftRepository.save(draft);
      await this.appendVersion(saved, "created", dto.changeSummary ?? "Initial template creation", actor, undefined, manager);
      await this.auditLogsService.append({
        action: "admin.templates.created",
        actor,
        context,
        targetType: "template",
        targetId: saved.id,
        afterState: this.buildTemplateAuditSnapshot(saved),
        metadata: { draftRevision: draft.revision, basedOnVersion: draft.basedOnVersion },
      }, manager);
      return saved.id;
    });

    return this.getTemplateDetail(savedId);
  }

  async updateTemplate(templateId: string, dto: AdminUpdateTemplateDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    const savedId = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Template);
      const template = await this.requireTemplateFrom(repository, templateId, true);
      const draftRepository = manager.getRepository(TemplateDraft);
      const existingDraft = await this.findDraftFrom(draftRepository, templateId, true);
      if (existingDraft && existingDraft.basedOnVersion !== template.templateVersion) {
        throw new ConflictException("This draft is based on an older published version. Refresh before saving again.");
      }

      const nextVersion = template.templateVersion + 1;
      const effectiveTemplate = this.materializeDraft(template, existingDraft, nextVersion);
      const beforeState = this.buildTemplateAuditSnapshot(effectiveTemplate);
      const validatedCanvasMeta = dto.canvasMeta !== undefined ? assertCanvasMeta(dto.canvasMeta, "canvasMeta") : undefined;
      const validatedComposition = dto.composition !== undefined
        ? assertTemplateComposition({
          ...dto.composition,
          templateId: template.id,
          templateVersion: nextVersion,
        }, {
          context: "composition",
          templateId: template.id,
          templateVersion: nextVersion,
          fallbackCanvasMeta: validatedCanvasMeta ?? normalizeCanvasMeta(effectiveTemplate.canvasMeta, DEFAULT_CANVAS_META),
        })
        : undefined;

      Object.assign(effectiveTemplate, {
        name: dto.name ?? effectiveTemplate.name,
        style: dto.style ?? effectiveTemplate.style,
        category: dto.category ?? effectiveTemplate.category,
        premium: dto.premium ?? effectiveTemplate.premium,
        animated: dto.animated ?? effectiveTemplate.animated,
        isActive: dto.isActive ?? effectiveTemplate.isActive,
        sortOrder: dto.sortOrder ?? effectiveTemplate.sortOrder,
        layoutVariant: dto.layoutVariant ?? effectiveTemplate.layoutVariant,
        playerVariant: dto.playerVariant ?? effectiveTemplate.playerVariant,
        overlayOpacity: dto.overlayOpacity ?? effectiveTemplate.overlayOpacity,
        previewImages: dto.previewImages !== undefined ? (dto.previewImages.length ? dto.previewImages : null) : effectiveTemplate.previewImages,
        canvasMeta: validatedComposition?.canvasMeta ?? validatedCanvasMeta ?? effectiveTemplate.canvasMeta,
        composition: validatedComposition ?? effectiveTemplate.composition,
        capabilities: dto.capabilities !== undefined ? dto.capabilities : effectiveTemplate.capabilities,
        designTokens: dto.designTokens !== undefined ? dto.designTokens : effectiveTemplate.designTokens,
        constraints: dto.constraints !== undefined ? dto.constraints : effectiveTemplate.constraints,
        designerNotes: dto.designerNotes !== undefined ? dto.designerNotes : effectiveTemplate.designerNotes,
        workflow: dto.workflow !== undefined ? dto.workflow : effectiveTemplate.workflow,
        certificationMeta: dto.certificationMeta !== undefined
          ? this.sanitizeCertificationForWritePath(dto.certificationMeta, effectiveTemplate.certificationMeta)
          : effectiveTemplate.certificationMeta,
        templateVersion: nextVersion,
        updatedByAdminUserId: actor?.id ?? null,
        updatedByAdminEmail: actor?.email ?? null,
        lastChangeSummary: dto.changeSummary ?? "Template updated",
      });

      this.assertIsolationConsistent(effectiveTemplate.capabilities);
      const nextDraft = existingDraft ?? draftRepository.create({ templateId: template.id });
      Object.assign(nextDraft, {
        basedOnVersion: template.templateVersion,
        revision: (existingDraft?.revision ?? 0) + 1,
        snapshot: this.buildTemplateDraftSnapshot(effectiveTemplate),
        authorAdminUserId: actor?.id ?? null,
        authorEmail: actor?.email ?? null,
        summary: dto.changeSummary ?? "Template updated",
      });
      const savedDraft = await draftRepository.save(nextDraft);
      await this.auditLogsService.append({
        action: "admin.templates.draft_saved",
        actor,
        context,
        targetType: "template",
        targetId: template.id,
        beforeState,
        afterState: this.buildTemplateAuditSnapshot(effectiveTemplate),
        metadata: {
          draftRevision: savedDraft.revision,
          basedOnVersion: savedDraft.basedOnVersion,
          targetVersion: nextVersion,
          summary: dto.changeSummary ?? "Template updated",
        },
      }, manager);
      return template.id;
    });

    return this.getTemplateDetail(savedId);
  }

  /**
   * Elevate the pending draft's certification (approved/certified). Separated from
   * the write path so the author of a draft cannot self-certify it — this method
   * is reachable only through the `templates.certify` permission. Publication
   * readiness then unblocks for a separate publisher.
   */
  async certifyTemplate(templateId: string, dto: AdminTemplateCertifyDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    const savedId = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Template);
      const template = await this.requireTemplateFrom(repository, templateId, true);
      const draftRepository = manager.getRepository(TemplateDraft);
      const draft = await this.findDraftFrom(draftRepository, templateId, true);
      if (!draft) {
        throw new ConflictException("There is no pending draft to certify");
      }
      if (draft.basedOnVersion !== template.templateVersion) {
        throw new ConflictException("This draft is based on an older published version. Refresh before certifying.");
      }

      const effective = this.materializeDraft(template, draft, template.templateVersion + 1);
      const beforeState = this.buildTemplateAuditSnapshot(effective);
      const now = new Date().toISOString();
      effective.certificationMeta = {
        ...(effective.certificationMeta ?? {}),
        status: dto.status,
        certifiedBy: actor?.email ?? undefined,
        certifiedAt: now,
        lastReviewedBy: actor?.email ?? undefined,
        lastReviewedAt: now,
        ...(dto.reviewNotes !== undefined ? { reviewNotes: dto.reviewNotes } : {}),
      };

      draft.snapshot = this.buildTemplateDraftSnapshot(effective);
      draft.revision += 1;
      draft.authorAdminUserId = actor?.id ?? draft.authorAdminUserId ?? null;
      draft.authorEmail = actor?.email ?? draft.authorEmail ?? null;
      draft.summary = dto.summary ?? `Certification set to ${dto.status}`;
      const savedDraft = await draftRepository.save(draft);

      await this.auditLogsService.append({
        action: "admin.templates.certified",
        actor,
        context,
        targetType: "template",
        targetId: template.id,
        beforeState,
        afterState: this.buildTemplateAuditSnapshot(effective),
        metadata: {
          certificationStatus: dto.status,
          draftRevision: savedDraft.revision,
          basedOnVersion: savedDraft.basedOnVersion,
          summary: draft.summary,
        },
      }, manager);
      return template.id;
    });

    return this.getTemplateDetail(savedId);
  }

  async publishTemplate(templateId: string, dto: AdminTemplateActionDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    const savedId = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Template);
      const template = await this.requireTemplateFrom(repository, templateId, true);
      const draftRepository = manager.getRepository(TemplateDraft);
      const draft = await this.findDraftFrom(draftRepository, templateId, true);
      if (!draft) {
        throw new ConflictException("There is no pending draft to publish");
      }
      if (draft.basedOnVersion !== template.templateVersion) {
        throw new ConflictException("This draft is based on an older published version. Refresh before publishing.");
      }

      const nextVersion = template.templateVersion + 1;
      const publishCandidate = this.materializeDraft(template, draft, nextVersion);
      const readiness = this.getPublicationReadiness(publishCandidate);
      if (!readiness.ready) {
        throw new BadRequestException({
          message: "Template is not ready to publish",
          blockers: readiness.blockers,
        });
      }

      const beforeState = this.buildTemplateAuditSnapshot(template);
      this.applyTemplateDraftSnapshot(template, draft.snapshot);
      template.canvasMeta = publishCandidate.canvasMeta;
      template.composition = publishCandidate.composition;
      template.status = "published";
      template.publishedAt = new Date();
      template.archivedAt = null;
      template.templateVersion = nextVersion;
      template.updatedByAdminUserId = actor?.id ?? draft.authorAdminUserId ?? null;
      template.updatedByAdminEmail = actor?.email ?? draft.authorEmail ?? null;
      template.lastChangeSummary = dto.summary ?? draft.summary ?? "Template published";
      const saved = await repository.save(template);
      await draftRepository.delete({ templateId });
      await this.appendVersion(saved, "published", dto.summary ?? "Template published", actor, true, manager);
      await this.auditLogsService.append({
        action: "admin.templates.published",
        actor,
        context,
        targetType: "template",
        targetId: saved.id,
        beforeState,
        afterState: this.buildTemplateAuditSnapshot(saved),
        metadata: {
          versionNumber: saved.templateVersion,
          draftRevision: draft.revision,
          basedOnVersion: draft.basedOnVersion,
          summary: dto.summary ?? draft.summary ?? "Template published",
        },
      }, manager);
      return saved.id;
    });
    return this.getTemplateDetail(savedId);
  }

  async archiveTemplate(templateId: string, dto: AdminTemplateActionDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    const savedId = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Template);
      const template = await this.requireTemplateFrom(repository, templateId, true);
      const draftRepository = manager.getRepository(TemplateDraft);
      const draft = await this.findDraftFrom(draftRepository, templateId, true);
      const beforeState = this.buildTemplateAuditSnapshot(template);
      const wasPublished = template.status === "published";
      template.status = "archived";
      template.isActive = false;
      template.archivedAt = new Date();
      template.templateVersion += 1;
      template.updatedByAdminUserId = actor?.id ?? null;
      template.updatedByAdminEmail = actor?.email ?? null;
      template.lastChangeSummary = dto.summary ?? "Template archived";
      const saved = await repository.save(template);
      if (draft) {
        draft.basedOnVersion = saved.templateVersion;
        await draftRepository.save(draft);
      }
      await this.appendVersion(saved, "archived", dto.summary ?? "Template archived", actor, wasPublished, manager);
      await this.auditLogsService.append({
        action: "admin.templates.archived",
        actor,
        context,
        targetType: "template",
        targetId: saved.id,
        beforeState,
        afterState: this.buildTemplateAuditSnapshot(saved),
        metadata: {
          summary: dto.summary ?? "Template archived",
          preservedDraftRevision: draft?.revision ?? null,
        },
      }, manager);
      return saved.id;
    });
    return this.getTemplateDetail(savedId);
  }

  async rollbackTemplate(templateId: string, dto: AdminTemplateRollbackDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    const savedId = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Template);
      const versionRepository = manager.getRepository(TemplateVersion);
      const template = await this.requireTemplateFrom(repository, templateId, true);
      const draftRepository = manager.getRepository(TemplateDraft);
      const existingDraft = await this.findDraftFrom(draftRepository, templateId, true);
      if (existingDraft && existingDraft.basedOnVersion !== template.templateVersion) {
        throw new ConflictException("This draft is based on an older published version. Refresh before rolling back.");
      }
      const targetVersion = await versionRepository.findOne({
        where: { templateId, versionNumber: dto.versionNumber },
      });
      if (!targetVersion) throw new NotFoundException(`Template version ${dto.versionNumber} not found`);

      const nextVersion = template.templateVersion + 1;
      const draftTemplate = this.materializeDraft(template, null, nextVersion);
      const beforeState = this.buildTemplateAuditSnapshot(
        existingDraft ? this.materializeDraft(template, existingDraft, nextVersion) : template,
      );
      const snapshot = targetVersion.snapshot as Record<string, any>;
      const restore = <K extends keyof Template>(key: K) => {
        if (Object.prototype.hasOwnProperty.call(snapshot, key)) draftTemplate[key] = snapshot[key] as Template[K];
      };
      const contentFields: Array<keyof Template> = [
        "name", "style", "category", "premium", "animated", "sortOrder", "layoutVariant",
        "playerVariant", "overlayOpacity", "canvasMeta", "composition",
        "capabilities", "designTokens", "constraints", "designerNotes", "workflow", "certificationMeta",
      ];
      for (const field of contentFields) restore(field);
      if (Object.prototype.hasOwnProperty.call(snapshot, "previewImages")) {
        draftTemplate.previewImages = this.restoreAuthoredPreviewImages(template.id, snapshot.previewImages);
      }

      const canvasMeta = assertCanvasMeta(draftTemplate.canvasMeta ?? DEFAULT_CANVAS_META, "canvasMeta");
      draftTemplate.canvasMeta = canvasMeta;
      draftTemplate.composition = draftTemplate.composition
        ? assertTemplateComposition({
          ...draftTemplate.composition,
          templateId: draftTemplate.id,
          templateVersion: nextVersion,
        }, {
          context: "composition",
          templateId: draftTemplate.id,
          templateVersion: nextVersion,
          fallbackCanvasMeta: canvasMeta,
        })
        : null;
      this.assertIsolationConsistent(draftTemplate.capabilities);

      const summary = dto.summary ?? `Rolled back draft to version ${dto.versionNumber}`;
      const draft = existingDraft ?? draftRepository.create({ templateId });
      Object.assign(draft, {
        basedOnVersion: template.templateVersion,
        revision: (existingDraft?.revision ?? 0) + 1,
        snapshot: this.buildTemplateDraftSnapshot(draftTemplate),
        authorAdminUserId: actor?.id ?? null,
        authorEmail: actor?.email ?? null,
        summary,
      });
      const savedDraft = await draftRepository.save(draft);
      await this.auditLogsService.append({
        action: "admin.templates.draft_rollback",
        actor,
        context,
        targetType: "template",
        targetId: template.id,
        beforeState,
        afterState: this.buildTemplateAuditSnapshot(draftTemplate),
        metadata: {
          rolledBackToVersion: dto.versionNumber,
          draftRevision: savedDraft.revision,
          basedOnVersion: savedDraft.basedOnVersion,
          summary,
        },
      }, manager);
      return template.id;
    });

    return this.getTemplateDetail(savedId);
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
    return this.requireTemplateFrom(this.templateRepository, templateId);
  }

  private async requireTemplateFrom(repository: Repository<Template>, templateId: string, lock = false) {
    const template = lock
      ? await repository.findOne({ where: { id: templateId }, lock: { mode: "pessimistic_write" } })
      : await repository.findOne({ where: { id: templateId } });
    if (!template) {
      throw new NotFoundException("Template not found");
    }
    return template;
  }

  private async findDraftFrom(repository: Repository<TemplateDraft>, templateId: string, lock = false) {
    return lock
      ? repository.findOne({ where: { templateId }, lock: { mode: "pessimistic_write" } })
      : repository.findOne({ where: { templateId } });
  }

  private buildTemplateDraftSnapshot(template: Template): Record<string, unknown> {
    const snapshot: Record<string, unknown> = {};
    for (const field of TEMPLATE_DRAFT_FIELDS) {
      snapshot[field] = template[field] ?? null;
    }
    return snapshot;
  }

  private applyTemplateDraftSnapshot(template: Template, snapshot: Record<string, unknown>) {
    for (const field of TEMPLATE_DRAFT_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(snapshot, field)) {
        template[field] = snapshot[field] as never;
      }
    }
  }

  private materializeDraft(template: Template, draft: TemplateDraft | null, targetVersion: number) {
    const effective = Object.assign(new Template(), template);
    if (draft) this.applyTemplateDraftSnapshot(effective, draft.snapshot);

    const canvasMeta = assertCanvasMeta(effective.canvasMeta ?? DEFAULT_CANVAS_META, "canvasMeta");
    effective.canvasMeta = canvasMeta;
    effective.composition = effective.composition
      ? assertTemplateComposition({
        ...effective.composition,
        templateId: effective.id,
        templateVersion: targetVersion,
      }, {
        context: "composition",
        templateId: effective.id,
        templateVersion: targetVersion,
        fallbackCanvasMeta: canvasMeta,
      })
      : null;
    effective.templateVersion = targetVersion;
    if (draft) {
      effective.updatedByAdminUserId = draft.authorAdminUserId ?? null;
      effective.updatedByAdminEmail = draft.authorEmail ?? null;
      effective.lastChangeSummary = draft.summary ?? null;
      effective.updatedAt = draft.updatedAt;
    }
    return effective;
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

  private serializeTemplateListItem(template: Template, usageCount: number, draft: TemplateDraft | null) {
    const effective = draft
      ? this.materializeDraft(template, draft, template.templateVersion + 1)
      : template;
    const summary = this.buildLayoutSummary(effective);
    return {
      id: template.id,
      name: effective.name,
      style: effective.style,
      category: effective.category,
      status: template.status,
      isActive: effective.isActive,
      premium: effective.premium,
      animated: effective.animated,
      sortOrder: effective.sortOrder,
      currentVersion: template.templateVersion,
      publishedVersion: template.templateVersion,
      hasPendingDraft: Boolean(draft),
      draftRevision: draft?.revision ?? null,
      draftBasedOnVersion: draft?.basedOnVersion ?? null,
      draftTargetVersion: draft ? template.templateVersion + 1 : null,
      updatedAt: draft?.updatedAt ?? template.updatedAt,
      createdAt: template.createdAt,
      usageCount,
      previewImages: this.normalizePreviewImages(template.id, effective.previewImages),
      widgetTypes: summary.widgetTypes,
      layoutSummary: summary,
    };
  }

  private serializeTemplateDetail(template: Template, usageCount: number, draft: TemplateDraft | null) {
    const effective = draft
      ? this.materializeDraft(template, draft, template.templateVersion + 1)
      : template;
    const summary = this.buildLayoutSummary(effective);
    return {
      id: template.id,
      name: effective.name,
      style: effective.style,
      category: effective.category,
      status: template.status,
      isActive: effective.isActive,
      premium: effective.premium,
      animated: effective.animated,
      sortOrder: effective.sortOrder,
      layoutVariant: effective.layoutVariant,
      playerVariant: effective.playerVariant,
      overlayOpacity: effective.overlayOpacity,
      currentVersion: template.templateVersion,
      publishedVersion: template.templateVersion,
      hasPendingDraft: Boolean(draft),
      draftRevision: draft?.revision ?? null,
      draftBasedOnVersion: draft?.basedOnVersion ?? null,
      draftTargetVersion: draft ? template.templateVersion + 1 : null,
      canvasMeta: effective.canvasMeta ?? null,
      composition: effective.composition ?? null,
      previewImages: this.normalizePreviewImages(template.id, effective.previewImages),
      // Keep authored assets separate from the gallery fallback so editing an
      // older template cannot accidentally persist the placeholder as content.
      authoredPreviewImages: effective.previewImages ?? [],
      widgetTypes: summary.widgetTypes,
      layoutSummary: summary,
      capabilities: effective.capabilities ?? null,
      designTokens: effective.designTokens ?? null,
      constraints: effective.constraints ?? null,
      designerNotes: effective.designerNotes ?? null,
      workflow: effective.workflow ?? null,
      certificationMeta: effective.certificationMeta ?? null,
      usageCount,
      popularityRank: null,
      conversionRate: null,
      creator: template.createdByAdminEmail ? { id: template.createdByAdminUserId ?? null, email: template.createdByAdminEmail } : null,
      lastEditor: effective.updatedByAdminEmail ? { id: effective.updatedByAdminUserId ?? null, email: effective.updatedByAdminEmail } : null,
      createdAt: template.createdAt,
      updatedAt: draft?.updatedAt ?? template.updatedAt,
      publishedAt: template.publishedAt ?? null,
      archivedAt: template.archivedAt ?? null,
      lastChangeSummary: effective.lastChangeSummary ?? null,
      publicationReadiness: this.getPublicationReadiness(effective),
      publishedTemplate: {
        name: template.name,
        status: template.status,
        isActive: template.isActive,
        currentVersion: template.templateVersion,
        previewImages: this.normalizePreviewImages(template.id, template.previewImages),
        updatedAt: template.updatedAt,
      },
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

  private restoreAuthoredPreviewImages(templateId: string, value: unknown): string[] | null {
    if (!Array.isArray(value)) return null;
    const previewImages = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    const legacyFallback = `${DEFAULT_TEMPLATE_PREVIEW_BASE}/preview-${templateId}.webp`;
    return previewImages.length === 1 && previewImages[0] === legacyFallback ? null : previewImages;
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
      previewImages: template.previewImages ?? null,
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

  private async appendVersion(
    template: Template,
    action: TemplateVersion["action"],
    summary: string,
    actor?: AdminRequestActor | null,
    published?: boolean,
    manager?: EntityManager,
  ) {
    const repository = manager?.getRepository(TemplateVersion) ?? this.templateVersionRepository;
    const version = repository.create({
      templateId: template.id,
      versionNumber: template.templateVersion,
      action,
      summary,
      published: published ?? template.status === "published",
      authorAdminUserId: actor?.id ?? null,
      authorEmail: actor?.email ?? null,
      snapshot: this.buildTemplateAuditSnapshot(template),
    });
    await repository.save(version);
  }
}
