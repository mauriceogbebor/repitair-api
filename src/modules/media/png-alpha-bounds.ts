import { inflateSync } from "node:zlib";

/**
 * Visible-content bounds of a transparent image, in PIXELS of the source image.
 * `x/y` is the top-left of the smallest rectangle enclosing every pixel whose
 * alpha exceeds the threshold; `width/height` is that rectangle's size.
 */
export interface VisibleBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Alpha threshold for "visible". A background-removed subject has hard-zero
 * background but antialiased/hair edges taper to low alpha; anything at or above
 * this counts as content so we don't clip soft edges. Deliberately low.
 */
export const DEFAULT_ALPHA_THRESHOLD = 16;

interface DecodedRgba {
  width: number;
  height: number;
  /** RGBA, 8-bit, row-major, length = width*height*4. */
  rgba: Uint8Array;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Minimal, dependency-free decoder for the EXACT shape remove.bg / our pipeline
 * emits: 8-bit, colour-type 6 (truecolour + alpha), non-interlaced PNG. Anything
 * else returns null so the caller falls back safely (no bounds → whole-frame fit)
 * rather than guessing. CRCs are not validated (we only read, never trust).
 */
export function decodeRgbaPng(buffer: Buffer): DecodedRgba | null {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = 0;
  const idatChunks: Buffer[] = [];

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > buffer.length) break;
    const data = buffer.subarray(dataStart, dataEnd);

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idatChunks.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4; // skip CRC
  }

  // Only the pipeline's canonical output shape is supported.
  if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) return null;
  if (width <= 0 || height <= 0 || idatChunks.length === 0) return null;

  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idatChunks));
  } catch {
    return null;
  }

  const channels = 4;
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) return null;

  const rgba = new Uint8Array(width * height * channels);
  let prevRow: Uint8Array | null = null;
  let src = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[src];
    src += 1;
    const row = new Uint8Array(stride);
    for (let i = 0; i < stride; i += 1) {
      const rawByte = raw[src + i];
      const a = i >= channels ? row[i - channels] : 0; // left
      const b = prevRow ? prevRow[i] : 0; // up
      const c = prevRow && i >= channels ? prevRow[i - channels] : 0; // up-left
      let value: number;
      switch (filter) {
        case 0: value = rawByte; break;
        case 1: value = rawByte + a; break;
        case 2: value = rawByte + b; break;
        case 3: value = rawByte + ((a + b) >> 1); break;
        case 4: value = rawByte + paeth(a, b, c); break;
        default: return null; // unknown filter — bail safely
      }
      row[i] = value & 0xff;
    }
    rgba.set(row, y * stride);
    prevRow = row;
    src += stride;
  }

  return { width, height, rgba };
}

/**
 * Pure scan: the bounding box of pixels whose alpha ≥ threshold. Returns null
 * when the image is fully transparent. Operates on a decoded RGBA buffer so it is
 * unit-testable with synthetic fixtures — no PNG needed.
 */
export function computeVisibleAlphaBounds(
  rgba: Uint8Array,
  width: number,
  height: number,
  threshold: number = DEFAULT_ALPHA_THRESHOLD,
): VisibleBounds | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = rgba[(y * width + x) * 4 + 3];
      if (alpha >= threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0 || maxY < 0) return null; // fully transparent
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Best-effort: decode a transparent PNG and return its visible-content bounds
 * plus the full image dimensions. Returns null on any unsupported/undecodable
 * input so the consumer falls back to whole-frame behaviour — never throws.
 */
export function computePngVisibleBounds(
  buffer: Buffer,
  threshold: number = DEFAULT_ALPHA_THRESHOLD,
): { width: number; height: number; visibleBounds: VisibleBounds } | null {
  const decoded = decodeRgbaPng(buffer);
  if (!decoded) return null;
  const visibleBounds = computeVisibleAlphaBounds(decoded.rgba, decoded.width, decoded.height, threshold);
  if (!visibleBounds) return null;
  return { width: decoded.width, height: decoded.height, visibleBounds };
}
