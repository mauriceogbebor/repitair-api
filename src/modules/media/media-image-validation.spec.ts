import { BadRequestException } from "@nestjs/common";
import {
  classifyProviderBytes,
  validateTransparentOutput,
} from "./media-image-validation";

// ── Minimal, real container headers ──────────────────────────────────────────
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Build a tiny but structurally valid PNG (IHDR) with the given color type. */
function makePng(colorType: number, width = 4, height = 4): Buffer {
  const b = Buffer.alloc(80, 0);
  Buffer.from(PNG_SIG).copy(b, 0);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  b[24] = 8; // bit depth
  b[25] = colorType; // 6 = truecolor+alpha
  return b;
}

function makeJpeg(): Buffer {
  const b = Buffer.alloc(80, 0);
  b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; b[3] = 0xe0; // SOI + APP0
  // SOF0 frame so dimensions parse
  b[10] = 0xff; b[11] = 0xc0; b.writeUInt16BE(17, 12); b[14] = 8;
  b.writeUInt16BE(4, 15); b.writeUInt16BE(4, 17);
  return b;
}

describe("classifyProviderBytes", () => {
  it("recognises PNG, JPEG, and text payloads by signature", () => {
    expect(classifyProviderBytes(makePng(6))).toBe("png");
    expect(classifyProviderBytes(makeJpeg())).toBe("jpeg");
    expect(classifyProviderBytes(Buffer.from('{"error":"x"}'))).toBe("json");
    expect(classifyProviderBytes(Buffer.from("  \n<!DOCTYPE html><html>"))).toBe("html");
    expect(classifyProviderBytes(Buffer.from("GIF89a....."))).toBe("gif");
    expect(classifyProviderBytes(Buffer.alloc(0))).toBe("empty");
    expect(classifyProviderBytes(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]))).toBe("unknown");
  });
});

describe("validateTransparentOutput", () => {
  it("accepts a real transparent PNG (truecolor+alpha)", () => {
    const info = validateTransparentOutput(makePng(6));
    expect(info.mime).toBe("image/png");
    expect(info.hasAlpha).toBe(true);
  });

  it("rejects a JPEG passthrough with a message that NAMES the format (stub scenario)", () => {
    expect(() => validateTransparentOutput(makeJpeg())).toThrow(BadRequestException);
    expect(() => validateTransparentOutput(makeJpeg())).toThrow(/returned JPEG instead of PNG/i);
  });

  it("rejects a JSON provider error body distinctly", () => {
    const json = Buffer.concat([Buffer.from('{"errors":[{"title":"Insufficient credits"}]}'), Buffer.alloc(40)]);
    expect(() => validateTransparentOutput(json)).toThrow(/JSON error payload/i);
  });

  it("rejects an HTML error page distinctly", () => {
    const html = Buffer.concat([Buffer.from("<!DOCTYPE html><html><body>502 Bad Gateway</body></html>"), Buffer.alloc(20)]);
    expect(() => validateTransparentOutput(html)).toThrow(/HTML error page/i);
  });

  it("rejects an empty/truncated response", () => {
    expect(() => validateTransparentOutput(Buffer.alloc(0))).toThrow(/empty or truncated/i);
    expect(() => validateTransparentOutput(Buffer.alloc(10))).toThrow(/empty or truncated/i);
  });

  it("rejects a PNG with no alpha channel (background not removed)", () => {
    expect(() => validateTransparentOutput(makePng(2))).toThrow(/no alpha channel/i);
  });

  it("keeps the generic message only for truly unknown binary", () => {
    const unknown = Buffer.alloc(80, 0x7a);
    expect(() => validateTransparentOutput(unknown)).toThrow(/not a valid PNG/i);
  });
});
