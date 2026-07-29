import { BadRequestException } from "@nestjs/common";
import { inspectImage, validateOriginalBytes, validateTransparentOutput } from "./media-image-validation";

// 1x1 RGBA transparent PNG (color type 6 → has alpha).
const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
// Minimal JPEG: SOI + APP0 + SOF0 (8x8) — enough for the header parser.
const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x08, 0x00, 0x08, 0x03, 0x01, 0x22,
  0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
]);

describe("media image byte-level validation", () => {
  it("detects a PNG with alpha from bytes", () => {
    const info = inspectImage(TRANSPARENT_PNG);
    expect(info?.mime).toBe("image/png");
    expect(info?.hasAlpha).toBe(true);
    expect(info?.width).toBe(1);
  });

  it("detects a JPEG and its dimensions from the SOF marker", () => {
    const info = inspectImage(JPEG);
    expect(info?.mime).toBe("image/jpeg");
    expect(info?.width).toBe(8);
    expect(info?.height).toBe(8);
  });

  it("rejects unrecognised / malformed bytes as an original", () => {
    expect(() => validateOriginalBytes(Buffer.from("this is definitely not an image at all"))).toThrow(BadRequestException);
  });

  it("rejects a content type that lies about the bytes", () => {
    // Actual bytes are PNG but the client claims JPEG.
    expect(() => validateOriginalBytes(TRANSPARENT_PNG, "image/jpeg")).toThrow(BadRequestException);
  });

  it("accepts a genuine image whose declared type matches", () => {
    expect(() => validateOriginalBytes(JPEG, "image/jpeg")).not.toThrow();
  });

  it("accepts valid transparent PNG provider output", () => {
    expect(() => validateTransparentOutput(TRANSPARENT_PNG)).not.toThrow();
  });

  it("rejects provider output that is not a PNG", () => {
    expect(() => validateTransparentOutput(Buffer.concat([JPEG, Buffer.alloc(40)]))).toThrow(BadRequestException);
  });

  it("rejects provider output with no alpha channel", () => {
    // Flip the PNG color type byte (offset 25) from 6 (RGBA) to 2 (RGB, no alpha).
    const opaque = Buffer.from(TRANSPARENT_PNG);
    opaque[25] = 2;
    expect(() => validateTransparentOutput(opaque)).toThrow(/alpha/i);
  });
});
