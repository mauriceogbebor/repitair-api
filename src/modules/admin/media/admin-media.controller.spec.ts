import { AdminMediaController } from "./admin-media.controller";

describe("AdminMediaController audit", () => {
  const actor = { id: "a1", email: "admin@test", fullName: "Admin", status: "active", roleKeys: [], permissionKeys: ["media.manage"] };
  const req = { adminUser: actor, adminRequestContext: { requestId: "r1", ipAddress: null, userAgent: null, method: "POST", path: "/admin/media" } } as never;

  function make() {
    const media = {
      inspect: jest.fn().mockResolvedValue({ processingStatus: "failed" }),
      retry: jest.fn().mockResolvedValue({ processingStatus: "queued" }),
      regenerate: jest.fn().mockResolvedValue({ processingStatus: "queued" }),
    };
    const auditLogs = { append: jest.fn().mockResolvedValue(undefined) };
    return { media, auditLogs, controller: new AdminMediaController(media as never, auditLogs as never) };
  }

  it("audits a retry with actor + before/after processing status", async () => {
    const { media, auditLogs, controller } = make();
    const result = await controller.retry("asset-1", req);

    expect(media.retry).toHaveBeenCalledWith("asset-1");
    expect(result).toEqual({ processingStatus: "queued" });
    expect(auditLogs.append).toHaveBeenCalledWith(expect.objectContaining({
      action: "admin.media.retried",
      actor,
      targetType: "media_asset",
      targetId: "asset-1",
      beforeState: { processingStatus: "failed" },
      afterState: { processingStatus: "queued" },
    }));
  });

  it("audits a regenerate", async () => {
    const { media, auditLogs, controller } = make();
    await controller.regenerate("asset-2", req);

    expect(media.regenerate).toHaveBeenCalledWith("asset-2");
    expect(auditLogs.append).toHaveBeenCalledWith(expect.objectContaining({
      action: "admin.media.regenerated",
      targetType: "media_asset",
      targetId: "asset-2",
    }));
  });

  it("still audits when the before-status lookup fails (best-effort)", async () => {
    const { media, auditLogs, controller } = make();
    media.inspect.mockRejectedValueOnce(new Error("not found"));
    await controller.retry("asset-3", req);

    expect(auditLogs.append).toHaveBeenCalledWith(expect.objectContaining({
      action: "admin.media.retried",
      beforeState: { processingStatus: null },
    }));
  });
});
