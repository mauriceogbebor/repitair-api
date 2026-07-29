import { BadRequestException } from "@nestjs/common";

/**
 * Dependency-free image inspection. We deliberately parse container headers
 * ourselves (no native `sharp`) so validation runs everywhere the API runs and
 * adds no build/runtime surface. It is used to validate the ACTUAL bytes — never
 * client-supplied metadata — before anything reaches a provider, and to verify
 * provider output before persistence.
 */

export interface ImageInspection {
  mime: string;
  width: number | null;
  height: number | null;
  hasAlpha: boolean;
}

const MAX_PIXELS = 40_000_000; // ~40MP — decompression-bomb ceiling.
const MAX_DIMENSION = 12_000;
const ALLOWED_INPUT_MIME = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

function u16be(b: Buffer, o: number): number { return b.readUInt16BE(o); }
function u32be(b: Buffer, o: number): number { return b.readUInt32BE(o); }

/** Detect container + dimensions + alpha from magic bytes. Returns null if unknown. */
export function inspectImage(buffer: Buffer): ImageInspection | null {
  if (buffer.length < 12) return null;

  // PNG
  if (buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    const width = u32be(buffer, 16);
    const height = u32be(buffer, 20);
    const colorType = buffer[25];
    let hasAlpha = colorType === 4 || colorType === 6; // gray+alpha / truecolor+alpha
    if (!hasAlpha) hasAlpha = buffer.includes(Buffer.from("tRNS")); // palette transparency
    return { mime: "image/png", width, height, hasAlpha };
  }

  // JPEG
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset++; continue; }
      const marker = buffer[offset + 1];
      // SOF0..SOF15 (skip SOF4/8/12 which are markers, not frames)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = u16be(buffer, offset + 5);
        const width = u16be(buffer, offset + 7);
        return { mime: "image/jpeg", width, height, hasAlpha: false };
      }
      const segLen = u16be(buffer, offset + 2);
      if (segLen < 2) break;
      offset += 2 + segLen;
    }
    return { mime: "image/jpeg", width: null, height: null, hasAlpha: false };
  }

  // WebP (RIFF....WEBP)
  if (buffer.slice(0, 4).toString("ascii") === "RIFF" && buffer.slice(8, 12).toString("ascii") === "WEBP") {
    const fmt = buffer.slice(12, 16).toString("ascii");
    let width: number | null = null, height: number | null = null, hasAlpha = false;
    if (fmt === "VP8X") { hasAlpha = (buffer[20] & 0x10) !== 0; }
    else if (fmt === "VP8 " && buffer.length > 29) { width = (u16be(buffer, 26) & 0x3fff); height = (u16be(buffer, 28) & 0x3fff); }
    return { mime: "image/webp", width, height, hasAlpha };
  }

  // HEIC/HEIF (ISO-BMFF: ....ftyp<brand>)
  if (buffer.slice(4, 8).toString("ascii") === "ftyp") {
    const brand = buffer.slice(8, 12).toString("ascii");
    if (["heic", "heix", "mif1", "heif", "hevc"].includes(brand)) {
      return { mime: "image/heic", width: null, height: null, hasAlpha: false };
    }
  }

  return null;
}

/**
 * Validate an UPLOADED original from its bytes before any provider call.
 * Rejects unknown/unsupported containers, decompression bombs, and images whose
 * declared type does not match the actual bytes.
 */
export function validateOriginalBytes(buffer: Buffer, declaredMime?: string): ImageInspection {
  const info = inspectImage(buffer);
  if (!info) throw new BadRequestException("Unrecognised or malformed image — upload a JPEG, PNG, WebP, or HEIC file");
  if (!ALLOWED_INPUT_MIME.includes(info.mime)) throw new BadRequestException(`Unsupported image type: ${info.mime}`);
  if (declaredMime && declaredMime !== info.mime && !(declaredMime === "image/jpeg" && info.mime === "image/jpeg")) {
    // Content type must match the actual bytes (prevents type spoofing).
    if (!(declaredMime.startsWith("image/hei") && info.mime === "image/heic")) {
      throw new BadRequestException("Declared content type does not match the image bytes");
    }
  }
  if (info.width != null && info.height != null) {
    if (info.width > MAX_DIMENSION || info.height > MAX_DIMENSION) throw new BadRequestException("Image dimensions exceed the supported maximum");
    if (info.width * info.height > MAX_PIXELS) throw new BadRequestException("Image resolution is too large to process");
  }
  return info;
}

/**
 * Validate PROVIDER OUTPUT before persisting it as a derivative. A transparent
 * derivative must be a real PNG with an alpha channel and sane dimensions —
 * otherwise the provider returned junk and we must not cache it.
 */
export function validateTransparentOutput(buffer: Buffer): ImageInspection {
  if (buffer.length < 67) throw new BadRequestException("Provider returned an empty or truncated image");
  const info = inspectImage(buffer);
  if (!info || info.mime !== "image/png") throw new BadRequestException("Provider output is not a valid PNG");
  if (!info.hasAlpha) throw new BadRequestException("Provider output has no alpha channel — background was not removed");
  if (info.width != null && info.height != null && info.width * info.height > MAX_PIXELS) {
    throw new BadRequestException("Provider output resolution is implausibly large");
  }
  return info;
}
