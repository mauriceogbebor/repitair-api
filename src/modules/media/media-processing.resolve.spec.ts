import { BadRequestException } from "@nestjs/common";
import { MediaProcessingService } from "./media-processing.service";
import type { MediaAsset } from "../../entities/media-asset.entity";

function makeService(
  assetService: Record<string, jest.Mock>,
  requiresBackgroundRemoval: boolean,
  templateAvailable = true,
) {
  const platformJobs = {
    enqueue: jest.fn(),
    enqueueWithManager: jest.fn(),
    findLatestForMediaAsset: jest.fn().mockResolvedValue(null),
    attachMediaCorrelation: jest.fn().mockResolvedValue({ id: "job-1" }),
  };
  const assets = { update: jest.fn(), increment: jest.fn() };
  const templates = {
    findOne: jest.fn().mockResolvedValue(templateAvailable ? {
      id: "template-1",
      status: "published",
      isActive: true,
      capabilities: { requiresBackgroundRemoval },
    } : null),
  };
  const repits = { findOne: jest.fn() };
  const storage = { objectExists: jest.fn().mockResolvedValue(true) };
  const backgroundRemoval = { compatibilityVersion: "provider-v1+pr1+pl1+out-transparent_png" };
  const dataSource = { transaction: jest.fn() };
  return new MediaProcessingService(
    assetService as never,
    platformJobs as never,
    assets as never,
    templates as never,
    repits as never,
    storage as never,
    backgroundRemoval as never,
    dataSource as never,
  );
}

describe("MediaProcessingService.resolveTemplateImage", () => {
  it("allows consumer access only when the asset has the authenticated owner", async () => {
    const assetService = {
      requireAsset: jest.fn().mockResolvedValue({ id: "a1", ownerUserId: "user-1" }),
      findReusableDerivative: jest.fn(),
      emit: jest.fn(),
    };
    const service = makeService(assetService, false);

    await expect(service.assertOwnership("a1", "user-1")).resolves.toEqual(
      expect.objectContaining({ id: "a1" }),
    );
  });

  it.each([
    [null, "user-1"],
    ["user-2", "user-1"],
  ])("rejects consumer access for owner %p requested by %p", async (ownerUserId, requestingUserId) => {
    const assetService = {
      requireAsset: jest.fn().mockResolvedValue({ id: "a1", ownerUserId }),
      findReusableDerivative: jest.fn(),
      emit: jest.fn(),
    };
    const service = makeService(assetService, false);

    await expect(service.assertOwnership("a1", requestingUserId)).rejects.toThrow(
      "You do not have access to this media asset",
    );
  });

  it("uses the ORIGINAL for a template that does not require isolation", async () => {
    const asset = { id: "a1", originalUrl: "http://x/o.jpg", processingStatus: "uploaded" } as MediaAsset;
    const assetService = { requireAsset: jest.fn().mockResolvedValue(asset), findReusableDerivative: jest.fn(), emit: jest.fn() };
    const service = makeService(assetService, false);

    const result = await service.resolveTemplateImage("a1", "template-1");
    expect(result).toEqual(expect.objectContaining({ imageUrl: "http://x/o.jpg", imageSource: "original", status: "ready", requiresBackgroundRemoval: false }));
    expect(assetService.findReusableDerivative).not.toHaveBeenCalled();
  });

  it("uses the transparent DERIVATIVE when isolation is required and processing is complete", async () => {
    const asset = { id: "a1", originalUrl: "http://x/o.jpg", processingStatus: "completed" } as MediaAsset;
    const assetService = {
      requireAsset: jest.fn().mockResolvedValue(asset),
      findReusableDerivative: jest.fn().mockResolvedValue({ id: "d1", key: "t.png", url: "http://x/t.png" }),
      emit: jest.fn(),
    };
    const service = makeService(assetService, true);

    const result = await service.resolveTemplateImage("a1", "template-1");
    expect(result).toEqual(expect.objectContaining({ imageUrl: "http://x/t.png", imageSource: "derivative", status: "ready", requiresBackgroundRemoval: true }));
  });

  it("NEVER substitutes the original when isolation is required but not ready — reports pending and auto-starts", async () => {
    const uploaded = { id: "a1", originalUrl: "http://x/o.jpg", processingStatus: "uploaded", lastError: null } as MediaAsset;
    const queued = { id: "a1", originalUrl: "http://x/o.jpg", processingStatus: "queued", lastError: null } as MediaAsset;
    const assetService = {
      requireAsset: jest.fn().mockResolvedValueOnce(uploaded).mockResolvedValueOnce(queued),
      findReusableDerivative: jest.fn().mockResolvedValue(null),
      emit: jest.fn(),
    };
    const service = makeService(assetService, true);
    const enqueueSpy = jest.spyOn(service, "enqueueProcessing").mockResolvedValue({ jobId: "job-1" } as never);

    const result = await service.resolveTemplateImage("a1", "template-1");
    expect(result.imageUrl).toBeNull();
    expect(result.imageSource).toBe("pending");
    expect(result.status).toBe("processing");
    expect(result.jobId).toBe("job-1");
    expect(result.queueDelayed).toBe(false);
    expect(enqueueSpy).toHaveBeenCalledWith("a1", { templateId: "template-1", incrementRetry: false });
  });

  it("returns authoritative job proof and derives a delayed queued state from server time", async () => {
    const queued = {
      id: "a1",
      originalUrl: "http://x/o.jpg",
      processingStatus: "queued",
      lastError: null,
    } as MediaAsset;
    const assetService = {
      requireAsset: jest.fn().mockResolvedValue(queued),
      findDerivative: jest.fn().mockResolvedValue(null),
      findReusableDerivative: jest.fn().mockResolvedValue(null),
      emit: jest.fn(),
    };
    const service = makeService(assetService, true);
    const platformJobs = (service as unknown as {
      platformJobs: { findLatestForMediaAsset: jest.Mock };
    }).platformJobs;
    platformJobs.findLatestForMediaAsset.mockResolvedValue({
      id: "job-delayed",
      status: "queued",
      queuedAt: new Date(Date.now() - 180_000),
      createdAt: new Date(Date.now() - 180_000),
    });

    const result = await service.status("a1");

    expect(result).toEqual(expect.objectContaining({
      jobId: "job-delayed",
      jobStatus: "queued",
      processingStatus: "queued",
      queueDelayed: true,
    }));
    expect(result.queuedAt).toBeInstanceOf(Date);
  });

  it("does not silently retry a failed provider attempt during ordinary reconciliation", async () => {
    const failed = { id: "a1", originalUrl: "http://x/o.jpg", processingStatus: "failed", lastError: "provider detail" } as MediaAsset;
    const assetService = {
      requireAsset: jest.fn().mockResolvedValue(failed),
      findReusableDerivative: jest.fn().mockResolvedValue(null),
      emit: jest.fn(),
    };
    const service = makeService(assetService, true);
    const enqueueSpy = jest.spyOn(service, "enqueueProcessing");

    const result = await service.resolveTemplateImage("a1", "template-1");

    expect(result).toEqual(expect.objectContaining({
      status: "failed",
      imageUrl: null,
      errorCode: "SUBJECT_PREPARATION_FAILED",
    }));
    expect(enqueueSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("provider detail");
  });

  it("retries a failed attempt only through the explicit template-authorized retry path", async () => {
    const failed = { id: "a1", originalUrl: "http://x/o.jpg", processingStatus: "failed", lastError: null } as MediaAsset;
    const queued = { ...failed, processingStatus: "queued" } as MediaAsset;
    const assetService = {
      requireAsset: jest.fn().mockResolvedValueOnce(failed).mockResolvedValueOnce(queued),
      findReusableDerivative: jest.fn().mockResolvedValue(null),
      emit: jest.fn(),
    };
    const service = makeService(assetService, true);
    const enqueueSpy = jest.spyOn(service, "enqueueProcessing").mockResolvedValue({ jobId: "job-2" } as never);

    const result = await service.resolveTemplateImage(
      "a1",
      "template-1",
      { autoStart: true, retryFailed: true },
    );

    expect(result.status).toBe("processing");
    expect(enqueueSpy).toHaveBeenCalledWith("a1", {
      templateId: "template-1",
      incrementRetry: true,
    });
  });

  it("rejects draft, archived, inactive, or unknown templates at the backend boundary", async () => {
    const assetService = { requireAsset: jest.fn(), findReusableDerivative: jest.fn(), emit: jest.fn() };
    const service = makeService(assetService, true, false);

    await expect(service.resolveTemplateImage("a1", "template-1")).rejects.toThrow(
      "Published template not found",
    );
    expect(assetService.requireAsset).not.toHaveBeenCalled();
  });

  it("links a Repit only when its persisted media provenance matches the asset", async () => {
    const assetService = { requireAsset: jest.fn(), findReusableDerivative: jest.fn(), emit: jest.fn() };
    const service = makeService(assetService, true);
    const dependencies = service as unknown as {
      repits: { findOne: jest.Mock };
      platformJobs: { attachMediaCorrelation: jest.Mock };
    };
    dependencies.repits.findOne.mockResolvedValue({
      id: "repit-1",
      userId: "user-1",
      templateId: "template-1",
      editorState: { mediaAssetId: "a1" },
    });

    const result = await service.linkRepit("a1", "repit-1", "template-1", "user-1");

    expect(result).toEqual(expect.objectContaining({ linked: true, jobId: "job-1" }));
    expect(dependencies.platformJobs.attachMediaCorrelation).toHaveBeenCalledWith("a1", {
      repitId: "repit-1",
      templateId: "template-1",
    });
  });

  it("rejects correlation when the Repit references a different media asset", async () => {
    const assetService = { requireAsset: jest.fn(), findReusableDerivative: jest.fn(), emit: jest.fn() };
    const service = makeService(assetService, true);
    const dependencies = service as unknown as { repits: { findOne: jest.Mock } };
    dependencies.repits.findOne.mockResolvedValue({
      id: "repit-1",
      userId: "user-1",
      templateId: "template-1",
      editorState: { mediaAssetId: "other-asset" },
    });

    await expect(service.linkRepit("a1", "repit-1", "template-1", "user-1")).rejects.toThrow(
      "Repit media does not match this asset",
    );
  });
});

describe("MediaProcessingService.assertRequiredIsolationReady", () => {
  const derivativeUrl = "https://media.example/subject.png";
  const template = {
    id: "audioverse",
    capabilities: { supportsIsolatedSubject: true, requiresBackgroundRemoval: true },
  } as never;
  const readyInput = {
    userId: "user-1",
    template,
    editorState: { mediaAssetId: "a1", processedPhotoUri: derivativeUrl },
    backgroundPhotoUrl: derivativeUrl,
    composition: {
      layers: [{ type: "photo", data: { uri: derivativeUrl } }],
    } as never,
  };

  function makeReadyService(overrides: {
    asset?: Record<string, unknown>;
    derivative?: Record<string, unknown> | null;
    objectExists?: boolean;
  } = {}) {
    const assetService = {
      requireAsset: jest.fn().mockResolvedValue({
        id: "a1",
        ownerUserId: "user-1",
        processingStatus: "completed",
        ...overrides.asset,
      }),
      findReusableDerivative: jest.fn().mockResolvedValue(
        overrides.derivative === null
          ? null
          : {
              id: "d1",
              key: "private/subject.png",
              url: derivativeUrl,
              mimeType: "image/png",
              ...overrides.derivative,
            },
      ),
      emit: jest.fn(),
    };
    const service = makeService(assetService, true);
    const dependencies = service as unknown as { storage: { objectExists: jest.Mock } };
    dependencies.storage.objectExists.mockResolvedValue(overrides.objectExists ?? true);
    return { service, assetService };
  }

  it("accepts a completed owned compatible derivative used canonically", async () => {
    const { service } = makeReadyService();

    await expect(service.assertRequiredIsolationReady(readyInput as never)).resolves.toEqual({
      assetId: "a1",
      derivativeUrl,
    });
  });

  it.each(["uploaded", "queued", "processing", "failed"])(
    "rejects an Audioverse save while the asset is %s",
    async (processingStatus) => {
      const { service } = makeReadyService({ asset: { processingStatus } });
      await expect(service.assertRequiredIsolationReady(readyInput as never)).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it("rejects a missing media asset reference", async () => {
    const { service } = makeReadyService();
    await expect(service.assertRequiredIsolationReady({
      ...readyInput,
      editorState: { processedPhotoUri: derivativeUrl },
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects a media asset owned by another user", async () => {
    const { service } = makeReadyService({ asset: { ownerUserId: "user-2" } });
    await expect(service.assertRequiredIsolationReady(readyInput as never)).rejects.toThrow(
      "You do not have access to this media asset",
    );
  });

  it.each([
    { name: "missing compatible derivative", overrides: { derivative: null } },
    { name: "non-PNG derivative", overrides: { derivative: { mimeType: "image/jpeg" } } },
    { name: "missing derivative object", overrides: { objectExists: false } },
  ])("rejects $name", async ({ overrides }) => {
    const { service } = makeReadyService(overrides);
    await expect(service.assertRequiredIsolationReady(readyInput as never)).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    ["backgroundPhotoUrl", { backgroundPhotoUrl: "https://media.example/original.jpg" }],
    ["processedPhotoUri", { editorState: { mediaAssetId: "a1", processedPhotoUri: "https://media.example/original.jpg" } }],
    ["composition photo", { composition: { layers: [{ type: "photo", data: { uri: "https://media.example/original.jpg" } }] } }],
  ])("rejects the original image in %s", async (_field, patch) => {
    const { service } = makeReadyService();
    await expect(service.assertRequiredIsolationReady({ ...readyInput, ...patch } as never))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it("leaves standard-template saves unchanged", async () => {
    const { service, assetService } = makeReadyService();
    await expect(service.assertRequiredIsolationReady({
      userId: "user-1",
      template: { id: "matcha-mood", capabilities: { requiresBackgroundRemoval: false } } as never,
    })).resolves.toBeNull();
    expect(assetService.requireAsset).not.toHaveBeenCalled();
  });
});
