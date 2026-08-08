import { deflateSync } from "node:zlib";
import {
  computeVisibleAlphaBounds,
  computePngVisibleBounds,
  decodeRgbaPng,
  DEFAULT_ALPHA_THRESHOLD,
} from "./png-alpha-bounds";

// ── Synthetic RGBA helpers ───────────────────────────────────────────────────

/** Build an RGBA buffer with a filled (opaque) rectangle on a transparent field. */
function rgbaWithRect(
  imgW: number,
  imgH: number,
  rect: { x: number; y: number; w: number; h: number },
  alpha = 255,
): Uint8Array {
  const rgba = new Uint8Array(imgW * imgH * 4); // all zero → transparent
  for (let y = rect.y; y < rect.y + rect.h; y += 1) {
    for (let x = rect.x; x < rect.x + rect.w; x += 1) {
      const i = (y * imgW + x) * 4;
      rgba[i] = 200; rgba[i + 1] = 150; rgba[i + 2] = 100; rgba[i + 3] = alpha;
    }
  }
  return rgba;
}

/** Encode RGBA as a real 8-bit colour-type-6 non-interlaced PNG (filter 0 rows). */
function encodePng(imgW: number, imgH: number, rgba: Uint8Array): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const stride = imgW * 4;
  const raw = Buffer.alloc((stride + 1) * imgH);
  for (let y = 0; y < imgH; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: None
    Buffer.from(rgba.subarray(y * stride, y * stride + stride)).copy(raw, y * (stride + 1) + 1);
  }
  const idat = deflateSync(raw);
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4); // decoder ignores CRC
    return Buffer.concat([len, Buffer.from(type, "ascii"), data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(imgW, 0); ihdr.writeUInt32BE(imgH, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

describe("computeVisibleAlphaBounds (pure scan)", () => {
  it("A. tightly cropped subject → bounds equal full frame", () => {
    const b = computeVisibleAlphaBounds(rgbaWithRect(10, 10, { x: 0, y: 0, w: 10, h: 10 }), 10, 10);
    expect(b).toEqual({ x: 0, y: 0, width: 10, height: 10 });
  });

  it("B. subject with large transparent margins → tight bounds", () => {
    const b = computeVisibleAlphaBounds(rgbaWithRect(100, 100, { x: 40, y: 30, w: 20, h: 50 }), 100, 100);
    expect(b).toEqual({ x: 40, y: 30, width: 20, height: 50 });
  });

  it("E. narrow subject inside a wide PNG", () => {
    const b = computeVisibleAlphaBounds(rgbaWithRect(200, 60, { x: 96, y: 5, w: 8, h: 50 }), 200, 60);
    expect(b).toEqual({ x: 96, y: 5, width: 8, height: 50 });
  });

  it("F. wide subject", () => {
    const b = computeVisibleAlphaBounds(rgbaWithRect(120, 120, { x: 10, y: 50, w: 100, h: 20 }), 120, 120);
    expect(b).toEqual({ x: 10, y: 50, width: 100, height: 20 });
  });

  it("G. subject touching the bottom edge", () => {
    const b = computeVisibleAlphaBounds(rgbaWithRect(40, 40, { x: 5, y: 20, w: 30, h: 20 }), 40, 40);
    expect(b).toEqual({ x: 5, y: 20, width: 30, height: 20 });
  });

  it("H. padding on all sides, honouring the alpha threshold (soft edges kept, noise dropped)", () => {
    const rgba = rgbaWithRect(50, 50, { x: 20, y: 20, w: 10, h: 10 }, 255);
    // A single sub-threshold pixel far away must NOT widen the bounds.
    const noiseIdx = (2 * 50 + 2) * 4; rgba[noiseIdx + 3] = DEFAULT_ALPHA_THRESHOLD - 1;
    // A soft (>= threshold) edge pixel MUST be included.
    const softIdx = (35 * 50 + 33) * 4; rgba[softIdx + 3] = DEFAULT_ALPHA_THRESHOLD;
    const b = computeVisibleAlphaBounds(rgba, 50, 50);
    expect(b).toEqual({ x: 20, y: 20, width: 14, height: 16 }); // extends to (33,35)
  });

  it("returns null for a fully transparent image", () => {
    expect(computeVisibleAlphaBounds(new Uint8Array(16 * 16 * 4), 16, 16)).toBeNull();
  });
});

describe("decodeRgbaPng + computePngVisibleBounds (round-trip)", () => {
  it("decodes a real colour-type-6 PNG and recovers exact visible bounds (C/D seated & waist-up)", () => {
    // Seated/waist-up: content occupies lower-centre with transparent top.
    const rgba = rgbaWithRect(64, 96, { x: 16, y: 40, w: 32, h: 56 });
    const png = encodePng(64, 96, rgba);
    const decoded = decodeRgbaPng(png);
    expect(decoded).not.toBeNull();
    expect(decoded!.width).toBe(64);
    expect(decoded!.height).toBe(96);
    const result = computePngVisibleBounds(png);
    expect(result).toEqual({ width: 64, height: 96, visibleBounds: { x: 16, y: 40, width: 32, height: 56 } });
  });

  it("survives non-None filters (Sub/Up/Paeth appear after deflate on real content)", () => {
    // A gradient body forces the encoder-independent decoder to unfilter correctly.
    const w = 24, h = 24; const rgba = new Uint8Array(w * h * 4);
    for (let y = 6; y < 18; y += 1) for (let x = 6; x < 18; x += 1) {
      const i = (y * w + x) * 4; rgba[i] = x * 8; rgba[i + 1] = y * 8; rgba[i + 2] = 60; rgba[i + 3] = 255;
    }
    const result = computePngVisibleBounds(encodePng(w, h, rgba));
    expect(result?.visibleBounds).toEqual({ x: 6, y: 6, width: 12, height: 12 });
  });

  it("returns null (safe fallback) for a non-PNG or unsupported payload", () => {
    expect(decodeRgbaPng(Buffer.from("not a png at all"))).toBeNull();
    expect(computePngVisibleBounds(Buffer.from([0xff, 0xd8, 0xff]))).toBeNull();
  });
});
