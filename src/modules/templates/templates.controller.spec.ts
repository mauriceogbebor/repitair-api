import { BadRequestException } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";

import { ADMIN_REQUIRED_PERMISSIONS_KEY } from "../admin/admin.constants";
import type { AdminRequest } from "../admin/admin.types";
import { AdminJwtAuthGuard } from "../admin/guards/admin-jwt-auth.guard";
import { AdminRbacGuard } from "../admin/guards/admin-rbac.guard";
import { TemplatesController } from "./templates.controller";

describe("TemplatesController", () => {
  const request = {
    adminUser: {
      id: "admin-1",
      email: "designer@example.test",
      fullName: "Template Designer",
      status: "active",
      roleKeys: ["template-admin"],
      permissionKeys: ["templates.write"],
    },
    adminRequestContext: {
      requestId: "request-1",
      ipAddress: null,
      userAgent: null,
      method: "PATCH",
      path: "/templates/admin/audioverse/composition",
    },
  } as AdminRequest;

  it("protects the compatibility mutation with Admin authentication and RBAC", () => {
    const handler = TemplatesController.prototype.updateTemplateComposition;

    expect(Reflect.getMetadata(ADMIN_REQUIRED_PERMISSIONS_KEY, handler)).toEqual(["templates.write"]);
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
      AdminJwtAuthGuard,
      AdminRbacGuard,
    ]);
  });

  it("delegates compatibility updates to the canonical transactional Admin service", async () => {
    const templates = { findAll: jest.fn() };
    const adminTemplates = { updateTemplate: jest.fn().mockResolvedValue({ id: "audioverse" }) };
    const controller = new TemplatesController(templates as never, adminTemplates as never);
    const composition = { version: 1, templateId: "audioverse", layers: [] };
    const canvasMeta = { width: 1080, height: 1920, aspectRatio: "9:16", coordinateSpace: "points" };

    await controller.updateTemplateComposition(
      "audioverse",
      { templateVersion: 999, composition, canvasMeta },
      request,
    );

    expect(adminTemplates.updateTemplate).toHaveBeenCalledWith(
      "audioverse",
      {
        composition,
        canvasMeta,
        changeSummary: "Composition updated through compatibility endpoint",
      },
      request.adminUser,
      request.adminRequestContext,
    );
  });

  it("rejects empty compatibility mutations before they reach the service", () => {
    const controller = new TemplatesController({} as never, { updateTemplate: jest.fn() } as never);

    expect(() => controller.updateTemplateComposition("audioverse", {}, request))
      .toThrow(BadRequestException);
  });
});
