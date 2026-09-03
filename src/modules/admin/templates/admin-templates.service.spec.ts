import { BadRequestException, ConflictException } from "@nestjs/common";

import { Template, TemplateDraft, TemplateVersion } from "../../../entities";
import { AdminTemplatesService } from "./admin-templates.service";

const canvasMeta = {
  width: 1080,
  height: 1920,
  aspectRatio: "9:16",
  coordinateSpace: "points" as const,
};

const composition = {
  version: 1 as const,
  templateId: "audioverse",
  templateVersion: 3,
  canvasMeta,
  layers: [
    {
      id: "photo",
      name: "Photo",
      type: "photo",
      interactive: true,
      frame: {
        x: 0,
        y: 0,
        width: 1080,
        height: 1920,
        scale: 1,
        rotation: 0,
        opacity: 1,
        zIndex: 1,
        locked: false,
        visible: true,
      },
      data: {},
    },
  ],
};

function makeTemplate(overrides: Partial<Template> = {}): Template {
  return {
    id: "audioverse",
    name: "Audioverse",
    style: "immersive",
    category: "dynamic",
    premium: false,
    animated: false,
    sortOrder: 1,
    status: "draft",
    isActive: true,
    layoutVariant: "classic",
    playerVariant: "default",
    overlayOpacity: 0.3,
    templateVersion: 3,
    canvasMeta,
    composition,
    previewImages: ["/images/templates/audioverse.webp"],
    capabilities: null,
    designTokens: null,
    constraints: null,
    designerNotes: null,
    workflow: null,
    certificationMeta: { status: "approved" },
    createdByAdminUserId: null,
    createdByAdminEmail: null,
    updatedByAdminUserId: null,
    updatedByAdminEmail: null,
    lastChangeSummary: null,
    publishedAt: null,
    archivedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  } as Template;
}

function makeDraft(template: Template, overrides: Partial<TemplateDraft> = {}): TemplateDraft {
  return {
    templateId: template.id,
    basedOnVersion: template.templateVersion,
    revision: 1,
    snapshot: {
      name: template.name,
      style: template.style,
      category: template.category,
      premium: template.premium,
      animated: template.animated,
      isActive: template.isActive,
      sortOrder: template.sortOrder,
      layoutVariant: template.layoutVariant,
      playerVariant: template.playerVariant,
      overlayOpacity: template.overlayOpacity,
      previewImages: template.previewImages,
      canvasMeta: template.canvasMeta,
      composition: template.composition,
      capabilities: template.capabilities,
      designTokens: template.designTokens,
      constraints: template.constraints,
      designerNotes: template.designerNotes,
      workflow: template.workflow,
      certificationMeta: template.certificationMeta,
    },
    authorAdminUserId: null,
    authorEmail: null,
    summary: null,
    createdAt: new Date("2026-01-02T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    ...overrides,
  } as TemplateDraft;
}

describe("AdminTemplatesService", () => {
  const actor = {
    id: "admin-1",
    email: "designer@example.test",
    fullName: "Template Designer",
    status: "active",
    roleKeys: ["template-admin"],
    permissionKeys: ["templates.write", "templates.publish", "templates.rollback"],
  };
  const context = {
    requestId: "request-1",
    ipAddress: null,
    userAgent: null,
    method: "PATCH",
    path: "/admin/templates/audioverse",
  };

  function setup(template: Template, options: {
    targetVersion?: Partial<TemplateVersion>;
    draft?: TemplateDraft | null;
  } = {}) {
    const templateRepository = {
      findOne: jest.fn().mockResolvedValue(template),
      save: jest.fn(async (value) => value),
    };
    const versionRepository = {
      findOne: jest.fn().mockResolvedValue(options.targetVersion ?? null),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    const draftRepository = {
      findOne: jest.fn().mockResolvedValue(options.draft ?? null),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const manager = {
      getRepository: jest.fn((entity) => {
        if (entity === Template) return templateRepository;
        if (entity === TemplateVersion) return versionRepository;
        if (entity === TemplateDraft) return draftRepository;
        throw new Error(`Unexpected repository ${String(entity)}`);
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (work) => work(manager)),
    };
    const auditLogs = { append: jest.fn().mockResolvedValue(undefined) };
    const service = new AdminTemplatesService(
      templateRepository as never,
      versionRepository as never,
      draftRepository as never,
      {} as never,
      {} as never,
      dataSource as never,
      auditLogs as never,
    );
    jest.spyOn(service, "getTemplateDetail").mockResolvedValue({ id: template.id } as never);

    return { service, templateRepository, versionRepository, draftRepository, auditLogs, dataSource };
  }

  it("rejects publishing until the server-side readiness gate passes", async () => {
    const template = makeTemplate({ status: "published" });
    const draft = makeDraft(template, {
      snapshot: { ...makeDraft(template).snapshot, previewImages: null },
    });
    const { service, templateRepository, versionRepository, auditLogs } = setup(template, { draft });

    await expect(service.publishTemplate(template.id, {}, actor, context))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(templateRepository.save).not.toHaveBeenCalled();
    expect(versionRepository.save).not.toHaveBeenCalled();
    expect(auditLogs.append).not.toHaveBeenCalled();
  });

  it("saves an isolated draft without mutating the published template", async () => {
    const template = makeTemplate({ status: "published" });
    const { service, templateRepository, versionRepository, draftRepository, auditLogs } = setup(template);

    await service.updateTemplate(template.id, {
      name: "Audioverse II",
      composition,
    }, actor, context);

    expect(template.name).toBe("Audioverse");
    expect(template.templateVersion).toBe(3);
    expect(templateRepository.save).not.toHaveBeenCalled();
    expect(draftRepository.save).toHaveBeenCalledWith(expect.objectContaining({
      basedOnVersion: 3,
      revision: 1,
      snapshot: expect.objectContaining({
        name: "Audioverse II",
        composition: expect.objectContaining({ templateVersion: 4 }),
      }),
    }));
    expect(versionRepository.save).not.toHaveBeenCalled();
    expect(auditLogs.append).toHaveBeenCalledTimes(1);
    expect(auditLogs.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: "admin.templates.draft_saved", targetId: template.id }),
      expect.anything(),
    );
  });

  it("atomically promotes one pending draft into one published version", async () => {
    const template = makeTemplate({ status: "published" });
    const draft = makeDraft(template, {
      revision: 4,
      snapshot: { ...makeDraft(template).snapshot, name: "Audioverse II" },
    });
    const { service, templateRepository, versionRepository, draftRepository, auditLogs } = setup(template, { draft });

    await service.publishTemplate(template.id, { summary: "Ship Audioverse II" }, actor, context);

    expect(template.name).toBe("Audioverse II");
    expect(template.status).toBe("published");
    expect(template.templateVersion).toBe(4);
    expect(template.composition?.templateVersion).toBe(4);
    expect(templateRepository.save).toHaveBeenCalledTimes(1);
    expect(draftRepository.delete).toHaveBeenCalledWith({ templateId: template.id });
    expect(versionRepository.save).toHaveBeenCalledTimes(1);
    expect(auditLogs.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin.templates.published",
        metadata: expect.objectContaining({ draftRevision: 4, versionNumber: 4 }),
      }),
      expect.anything(),
    );
  });

  it("restores historical content into a new draft without restoring publication state", async () => {
    const template = makeTemplate({
      status: "archived",
      isActive: false,
      templateVersion: 8,
      publishedAt: new Date("2026-02-01T00:00:00.000Z"),
      archivedAt: new Date("2026-03-01T00:00:00.000Z"),
    });
    const historicalSnapshot = {
      ...makeTemplate({
        name: "Historical Audioverse",
        status: "published",
        isActive: true,
        templateVersion: 2,
      }),
      previewImages: ["/images/templates/audioverse-v2.webp"],
    };
    const { service, templateRepository, versionRepository, draftRepository, auditLogs } = setup(template, {
      targetVersion: {
        templateId: template.id,
        versionNumber: 2,
        snapshot: historicalSnapshot,
      },
    });

    await service.rollbackTemplate(template.id, { versionNumber: 2 }, actor, context);

    expect(template.name).toBe("Audioverse");
    expect(template.status).toBe("archived");
    expect(template.isActive).toBe(false);
    expect(template.templateVersion).toBe(8);
    expect(templateRepository.save).not.toHaveBeenCalled();
    expect(draftRepository.save).toHaveBeenCalledWith(expect.objectContaining({
      basedOnVersion: 8,
      revision: 1,
      snapshot: expect.objectContaining({
        name: "Historical Audioverse",
        isActive: false,
        previewImages: ["/images/templates/audioverse-v2.webp"],
      }),
    }));
    expect(versionRepository.save).not.toHaveBeenCalled();
    expect(auditLogs.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin.templates.draft_rollback",
        metadata: expect.objectContaining({ rolledBackToVersion: 2, draftRevision: 1 }),
      }),
      expect.anything(),
    );
  });

  it("rejects publishing a stale draft instead of overwriting a newer live version", async () => {
    const template = makeTemplate({ status: "published", templateVersion: 5 });
    const draft = makeDraft(template, { basedOnVersion: 4 });
    const { service, templateRepository, versionRepository, draftRepository } = setup(template, { draft });

    await expect(service.publishTemplate(template.id, {}, actor, context))
      .rejects.toBeInstanceOf(ConflictException);

    expect(templateRepository.save).not.toHaveBeenCalled();
    expect(versionRepository.save).not.toHaveBeenCalled();
    expect(draftRepository.delete).not.toHaveBeenCalled();
  });

  it("does not let the write path elevate certification (separation of duties)", async () => {
    const template = makeTemplate({ status: "published", certificationMeta: { status: "product-review" } });
    const { service, draftRepository, templateRepository } = setup(template);

    await service.updateTemplate(template.id, {
      certificationMeta: { status: "certified" },
    } as never, actor, context);

    expect(templateRepository.save).not.toHaveBeenCalled();
    expect(draftRepository.save).toHaveBeenCalledWith(expect.objectContaining({
      snapshot: expect.objectContaining({
        certificationMeta: expect.objectContaining({ status: "product-review" }),
      }),
    }));
  });

  it("certifies a pending draft through the permission-gated path and audits it", async () => {
    const template = makeTemplate({ status: "published", certificationMeta: { status: "product-review" } });
    const draft = makeDraft(template, {
      snapshot: { ...makeDraft(template).snapshot, certificationMeta: { status: "product-review" } },
    });
    const { service, draftRepository, templateRepository, auditLogs } = setup(template, { draft });

    await service.certifyTemplate(template.id, { status: "certified", summary: "QA passed" }, actor, context);

    expect(templateRepository.save).not.toHaveBeenCalled();
    expect(draftRepository.save).toHaveBeenCalledWith(expect.objectContaining({
      snapshot: expect.objectContaining({
        certificationMeta: expect.objectContaining({ status: "certified", certifiedBy: actor.email }),
      }),
    }));
    expect(auditLogs.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin.templates.certified",
        metadata: expect.objectContaining({ certificationStatus: "certified" }),
      }),
      expect.anything(),
    );
  });

  it("rejects certification when there is no pending draft", async () => {
    const template = makeTemplate({ status: "published" });
    const { service } = setup(template, { draft: null });

    await expect(service.certifyTemplate(template.id, { status: "approved" }, actor, context))
      .rejects.toBeInstanceOf(ConflictException);
  });
});
