import { BadRequestException } from "@nestjs/common";
import { BackgroundRemovalService } from "./background-removal.service";
import { MediaAssetService } from "./media-asset.service";
import type { MediaAsset } from "../../entities/media-asset.entity";

describe("BackgroundRemovalService", () => {
  const asset = { id: "asset-1", originalUrl: "http://x/o.jpg", mimeType: "image/jpeg" } as MediaAsset;
  const provider = { name: "stub", version: "stub-v0", removeBackground: jest.fn() };
  const assetService = { findReusableDerivative: jest.fn(), saveDerivative: jest.fn((v) => ({ id: "d1", ...v })), emit: jest.fn() };
  const storage = { readBytes: jest.fn(), storeDerivative: jest.fn() };
  let service: BackgroundRemovalService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BackgroundRemovalService(provider as never, assetService as never, storage as never);
  });

  it("reuses an existing derivative for the same provider version WITHOUT an AI call (process once)", async () => {
    assetService.findReusableDerivative.mockResolvedValue({ id: "cached", url: "http://x/t.png" });
    const result = await service.process(asset);
    expect(result).toEqual(expect.objectContaining({ id: "cached" }));
    expect(provider.removeBackground).not.toHaveBeenCalled();
    expect(storage.readBytes).not.toHaveBeenCalled();
    expect(assetService.emit).toHaveBeenCalledWith("media.cache_hit", expect.objectContaining({ assetId: "asset-1" }));
  });

  it("processes once and records provenance when no cached derivative exists", async () => {
    assetService.findReusableDerivative.mockResolvedValue(null);
    storage.readBytes.mockResolvedValue(Buffer.from("src"));
    provider.removeBackground.mockResolvedValue({ buffer: Buffer.from("out"), mimeType: "image/png" });
    storage.storeDerivative.mockResolvedValue({ url: "http://x/t.png", key: "t.png" });

    const result = await service.process(asset);

    expect(provider.removeBackground).toHaveBeenCalledTimes(1);
    expect(assetService.saveDerivative).toHaveBeenCalledWith(expect.objectContaining({
      assetId: "asset-1", kind: "transparent_png", provider: "stub", providerVersion: "stub-v0+pl1", pipelineVersion: 1, url: "http://x/t.png",
    }));
    expect(assetService.emit).toHaveBeenCalledWith("media.processed", expect.objectContaining({ assetId: "asset-1" }));
    expect(result.id).toBe("d1");
  });
});

describe("MediaAssetService.validateUpload (security)", () => {
  it("rejects unsupported types", () => {
    expect(() => MediaAssetService.validateUpload({ mimeType: "application/pdf" })).toThrow(BadRequestException);
  });
  it("rejects oversized images", () => {
    expect(() => MediaAssetService.validateUpload({ mimeType: "image/png", bytes: 20 * 1024 * 1024 })).toThrow(BadRequestException);
  });
  it("rejects absurd dimensions", () => {
    expect(() => MediaAssetService.validateUpload({ mimeType: "image/png", width: 99999 })).toThrow(BadRequestException);
  });
  it("accepts a valid image", () => {
    expect(() => MediaAssetService.validateUpload({ mimeType: "image/jpeg", bytes: 1024, width: 1080, height: 1080 })).not.toThrow();
  });
});
