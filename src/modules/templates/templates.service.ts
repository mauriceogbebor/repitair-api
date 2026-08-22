import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import { normalizeTemplateState } from "../../common/composition/composition.utils";
import { Template } from "../../entities/template.entity";

@Injectable()
export class TemplatesService {
  constructor(
    @InjectRepository(Template)
    private readonly repo: Repository<Template>,
  ) {}

  async findAll() {
    const templates = await this.repo.find({
      where: { status: "published", isActive: true },
      order: { sortOrder: "ASC" },
    });
    return templates.map((template) => this.serializeForPublic(this.normalizeTemplate(template)));
  }

  // NOTE: direct composition writes now flow through AdminTemplatesService.updateTemplate
  // (draft-based, RBAC-guarded, audited) via the /templates/admin/:id/composition endpoint.
  // The former public-service updateComposition() write path was removed to avoid a
  // second, un-audited way to mutate a live template row.

  private normalizeTemplate(template: Template): Template {
    return normalizeTemplateState(template) as Template;
  }

  /** Keep the existing public contract explicit so future internal columns do not leak by default. */
  private serializeForPublic(template: Template): Omit<
    Template,
    | "designerNotes"
    | "certificationMeta"
    | "createdByAdminUserId"
    | "createdByAdminEmail"
    | "updatedByAdminUserId"
    | "updatedByAdminEmail"
    | "lastChangeSummary"
  > {
    return {
      id: template.id,
      name: template.name,
      style: template.style,
      category: template.category,
      premium: template.premium,
      animated: template.animated,
      sortOrder: template.sortOrder,
      status: template.status,
      isActive: template.isActive,
      layoutVariant: template.layoutVariant,
      playerVariant: template.playerVariant,
      overlayOpacity: template.overlayOpacity,
      templateVersion: template.templateVersion,
      canvasMeta: template.canvasMeta,
      composition: template.composition,
      previewImages: template.previewImages,
      capabilities: template.capabilities,
      designTokens: template.designTokens,
      constraints: template.constraints,
      workflow: template.workflow,
      publishedAt: template.publishedAt,
      archivedAt: template.archivedAt,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    };
  }
}
