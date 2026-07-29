import { BadRequestException } from "@nestjs/common";
import { BackgroundRemovalService } from "./background-removal.service";
import { MediaAssetService } from "./media-asset.service";
import type { MediaAsset } from "../../entities/media-asset.entity";

// A real 1x1 RGBA (color type 6, has alpha) transparent PNG — passes byte-level
// provider-output validation.
const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

describe("BackgroundRemovalService", () => {
  const asset = { id: "asset-1", originalKey: "o.jpg", originalUrl: "http://x/o.jpg", mimeType: "image/jpeg", checksum: "chk-1" } as MediaAsset;
  const provider = { name: "stub", version: "stub-v0", removeBackground: jest.fn() };
  const assetService = {
    findReusableDerivative: jest.fn(),
    findByContent: jest.fn(),
    saveDerivative: jest.fn((v) => ({ id: "d1", ...v })),
    removeDerivative: jest.fn(),
    emit: jest.fn(),
  };
  const storage = { readByKey: jest.fn(), storeDerivative: jest.fn(), objectExists: jest.fn() };
  let service: BackgroundRemovalService;

  beforeEach(() => {
    jest.clearAllMocks();
    assetService.findByContent.mockResolvedValue(null);
    storage.objectExists.mockResolvedValue(true);
    service = new BackgroundRemovalService(provider as never, assetService as never, storage as never);
  });

  it("reuses this asset's derivative for the same version WITHOUT an AI call (process once)", async () => {
    assetService.findReusableDerivative.mockResolvedValue({ id: "cached", key: "t.png", url: "http://x/t.png" });
    const result = await service.process(asset);
    expect(result).toEqual(expect.objectContaining({ id: "cached" }));
    expect(provider.removeBackground).not.toHaveBeenCalled();
    expect(storage.readByKey).not.toHaveBeenCalled();
    expect(assetService.emit).toHaveBeenCalledWith("media.cache_hit", expect.objectContaining({ assetId: "asset-1", scope: "asset" }));
  });

  it("reuses a CONTENT-addressed match (same checksum, other asset) WITHOUT an AI call", async () => {
    assetService.findReusableDerivative.mockResolvedValue(null);
    assetService.findByContent.mockResolvedValue({ id: "shared", key: "t.png", url: "http://x/t.png", mimeType: "image/png", provider: "remove_bg" });
    const result = await service.process(asset);
    expect(provider.removeBackground).not.toHaveBeenCalled();
    expect(storage.readByKey).not.toHaveBeenCalled();
    expect(assetService.saveDerivative).toHaveBeenCalledWith(expect.objectContaining({ assetId: "asset-1", sourceChecksum: "chk-1", key: "t.png" }));
    expect(assetService.emit).toHaveBeenCalledWith("media.cache_hit", expect.objectContaining({ scope: "content" }));
    expect(result.id).toBe("d1");
  });

  it("does not reuse a per-asset cache row when its storage object is missing", async () => {
    assetService.findReusableDerivative.mockResolvedValue({ id: "stale", key: "missing.png", url: "http://x/missing.png" });
    storage.objectExists.mockResolvedValue(false);
    storage.readByKey.mockResolvedValue(Buffer.from("src"));
    provider.removeBackground.mockResolvedValue({ buffer: TRANSPARENT_PNG, mimeType: "image/png" });
    storage.storeDerivative.mockResolvedValue({ url: "http://x/fresh.png", key: "fresh.png" });

    const result = await service.process(asset);

    expect(assetService.removeDerivative).toHaveBeenCalledWith("stale");
    expect(provider.removeBackground).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({ key: "fresh.png" }));
  });

  it("does not copy a content-addressed cache row when its storage object is missing", async () => {
    assetService.findReusableDerivative.mockResolvedValue(null);
    assetService.findByContent.mockResolvedValue({
      id: "stale-shared",
      key: "missing.png",
      url: "http://x/missing.png",
      mimeType: "image/png",
      provider: "remove_bg",
    });
    storage.objectExists.mockResolvedValue(false);
    storage.readByKey.mockResolvedValue(Buffer.from("src"));
    provider.removeBackground.mockResolvedValue({ buffer: TRANSPARENT_PNG, mimeType: "image/png" });
    storage.storeDerivative.mockResolvedValue({ url: "http://x/fresh.png", key: "fresh.png" });

    await service.process(asset);

    expect(assetService.removeDerivative).toHaveBeenCalledWith("stale-shared");
    expect(provider.removeBackground).toHaveBeenCalledTimes(1);
  });

  it("processes once, validates output, and records provenance when no cache exists", async () => {
    assetService.findReusableDerivative.mockResolvedValue(null);
    storage.readByKey.mockResolvedValue(Buffer.from("src"));
    provider.removeBackground.mockResolvedValue({ buffer: TRANSPARENT_PNG, mimeType: "image/png" });
    storage.storeDerivative.mockResolvedValue({ url: "http://x/t.png", key: "t.png" });

    const result = await service.process(asset);

    expect(storage.readByKey).toHaveBeenCalledWith("o.jpg");
    expect(provider.removeBackground).toHaveBeenCalledTimes(1);
    expect(assetService.saveDerivative).toHaveBeenCalledWith(expect.objectContaining({
      assetId: "asset-1", kind: "transparent_png", provider: "stub", providerVersion: "stub-v0+pr1+pl1+out-transparent_png", pipelineVersion: 1, sourceChecksum: "chk-1", url: "http://x/t.png",
    }));
    expect(assetService.emit).toHaveBeenCalledWith("media.processed", expect.objectContaining({ assetId: "asset-1" }));
    expect(result.id).toBe("d1");
  });

  it("REJECTS provider output that is not a transparent PNG (no persistence)", async () => {
    assetService.findReusableDerivative.mockResolvedValue(null);
    storage.readByKey.mockResolvedValue(Buffer.from("src"));
    provider.removeBackground.mockResolvedValue({ buffer: Buffer.from("not-a-png-at-all-just-junk-bytes-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"), mimeType: "image/png" });
    await expect(service.process(asset)).rejects.toThrow();
    expect(storage.storeDerivative).not.toHaveBeenCalled();
    expect(assetService.saveDerivative).not.toHaveBeenCalled();
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
