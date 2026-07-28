import { MediaProcessingService } from "./media-processing.service";
import type { MediaAsset } from "../../entities/media-asset.entity";

function makeService(assetService: Record<string, jest.Mock>) {
  const platformJobs = { enqueue: jest.fn() };
  const assets = { update: jest.fn(), increment: jest.fn() };
  return new MediaProcessingService(assetService as never, platformJobs as never, assets as never);
}

describe("MediaProcessingService.resolveTemplateImage", () => {
  it("uses the ORIGINAL for a template that does not require isolation", async () => {
    const asset = { id: "a1", originalUrl: "http://x/o.jpg", processingStatus: "uploaded" } as MediaAsset;
    const assetService = { requireAsset: jest.fn().mockResolvedValue(asset), findDerivative: jest.fn(), emit: jest.fn() };
    const service = makeService(assetService);

    const result = await service.resolveTemplateImage("a1", false);
    expect(result).toEqual(expect.objectContaining({ image: "http://x/o.jpg", source: "original", ready: true }));
    expect(assetService.findDerivative).not.toHaveBeenCalled();
  });

  it("uses the transparent DERIVATIVE when isolation is required and processing is complete", async () => {
    const asset = { id: "a1", originalUrl: "http://x/o.jpg", processingStatus: "completed" } as MediaAsset;
    const assetService = {
      requireAsset: jest.fn().mockResolvedValue(asset),
      findDerivative: jest.fn().mockResolvedValue({ url: "http://x/t.png" }),
      emit: jest.fn(),
    };
    const service = makeService(assetService);

    const result = await service.resolveTemplateImage("a1", true);
    expect(result).toEqual(expect.objectContaining({ image: "http://x/t.png", source: "derivative", ready: true }));
  });

  it("NEVER substitutes the original when isolation is required but not ready — reports pending and auto-starts", async () => {
    const uploaded = { id: "a1", originalUrl: "http://x/o.jpg", processingStatus: "uploaded", lastError: null } as MediaAsset;
    const queued = { id: "a1", originalUrl: "http://x/o.jpg", processingStatus: "queued", lastError: null } as MediaAsset;
    const assetService = {
      requireAsset: jest.fn().mockResolvedValueOnce(uploaded).mockResolvedValueOnce(queued),
      findDerivative: jest.fn().mockResolvedValue(null),
      emit: jest.fn(),
    };
    const service = makeService(assetService);
    const enqueueSpy = jest.spyOn(service, "enqueueProcessing").mockResolvedValue(undefined as never);

    const result = await service.resolveTemplateImage("a1", true);
    expect(result.image).toBeNull();
    expect(result.source).toBe("pending");
    expect(result.ready).toBe(false);
    expect(enqueueSpy).toHaveBeenCalledWith("a1");
  });
});
