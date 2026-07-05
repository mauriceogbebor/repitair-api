import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import {
  assertCanvasMeta,
  assertTemplateComposition,
  DEFAULT_CANVAS_META,
  normalizeCanvasMeta,
  normalizeTemplateState,
} from "../../common/composition/composition.utils";
import { Template } from "../../entities/template.entity";
import { UpdateTemplateCompositionDto } from "./dto/update-template-composition.dto";

@Injectable()
export class TemplatesService {
  constructor(
    @InjectRepository(Template)
    private readonly repo: Repository<Template>,
  ) {}

  async findAll() {
    const templates = await this.repo.find({ order: { sortOrder: "ASC" } });
    return templates.map((template) => this.serializeForPublic(this.normalizeTemplate(template)));
  }

  async updateComposition(id: string, body: UpdateTemplateCompositionDto) {
    const template = await this.repo.findOne({ where: { id } });
    if (!template) {
      throw new NotFoundException(`Template "${id}" not found`);
    }

    if (body.composition === undefined && body.canvasMeta === undefined && body.templateVersion === undefined) {
      throw new BadRequestException("At least one composition field must be provided");
    }

    const validatedCanvasMeta = body.canvasMeta !== undefined
      ? assertCanvasMeta(body.canvasMeta, "canvasMeta")
      : undefined;
    const validatedComposition = body.composition !== undefined
      ? assertTemplateComposition(body.composition, {
        context: "composition",
        templateId: template.id,
        templateVersion: body.templateVersion ?? template.templateVersion,
        fallbackCanvasMeta: validatedCanvasMeta ?? normalizeCanvasMeta(template.canvasMeta, DEFAULT_CANVAS_META),
      })
      : undefined;

    const updated = this.repo.merge(template, {
      templateVersion: body.templateVersion !== undefined
        ? body.templateVersion ?? template.templateVersion
        : (validatedComposition?.templateVersion ?? template.templateVersion),
      canvasMeta: validatedCanvasMeta !== undefined || validatedComposition !== undefined
        ? (validatedComposition?.canvasMeta ?? validatedCanvasMeta ?? template.canvasMeta)
        : template.canvasMeta,
      composition: validatedComposition !== undefined ? validatedComposition : template.composition,
    });

    const saved = await this.repo.save(updated);
    return this.serializeForPublic(this.normalizeTemplate(saved));
  }

  private normalizeTemplate(template: Template): Template {
    return normalizeTemplateState(template) as Template;
  }

  /**
   * Strip internal-only fields from the public API response.
   * designerNotes and certificationMeta are strictly admin-internal.
   */
  private serializeForPublic(template: Template): Omit<Template, "designerNotes" | "certificationMeta"> {
    const { designerNotes, certificationMeta, ...publicFields } = template;
    return publicFields;
  }
}
