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
 * Coarse byte-signature classification of an arbitrary provider response. Used to
 * turn "not a valid PNG" into a diagnosable message that names WHAT the provider
 * actually returned (a passthrough JPEG, a JSON/HTML error page, empty, …). This
 * is diagnosis only — it never widens what we ACCEPT as a valid derivative.
 */
export type ProviderPayloadKind =
  | "png" | "jpeg" | "webp" | "heic" | "gif" | "json" | "html" | "empty" | "unknown";

export function classifyProviderBytes(buffer: Buffer): ProviderPayloadKind {
  if (!buffer || buffer.length === 0) return "empty";
  if (buffer.length >= 8 && buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (buffer.length >= 12 && buffer.slice(0, 4).toString("ascii") === "RIFF" && buffer.slice(8, 12).toString("ascii") === "WEBP") return "webp";
  if (buffer.length >= 12 && buffer.slice(4, 8).toString("ascii") === "ftyp") return "heic";
  if (buffer.length >= 4 && buffer.slice(0, 4).toString("ascii") === "GIF8") return "gif";
  // Text payloads (provider error bodies). Sniff the first non-whitespace byte.
  const head = buffer.slice(0, 64).toString("utf8").trimStart();
  if (head.startsWith("{") || head.startsWith("[")) return "json";
  if (head.startsWith("<")) return "html";
  return "unknown";
}

/** First N bytes as hex (safe to log — never image content). */
export function bytePrefixHex(buffer: Buffer, n = 16): string {
  return Buffer.from(buffer.slice(0, n)).toString("hex").match(/.{1,2}/g)?.join(" ") ?? "";
}

/**
 * Validate PROVIDER OUTPUT before persisting it as a derivative. A transparent
 * derivative must be a real PNG with an alpha channel and sane dimensions —
 * otherwise the provider returned junk and we must not cache it.
 *
 * The rejection message NAMES what actually came back so a misconfigured provider
 * (e.g. a stub passing through the original JPEG, or a JSON/HTML error body) is
 * diagnosable at a glance. Acceptance is unchanged: only a real transparent PNG
 * passes.
 */
export function validateTransparentOutput(buffer: Buffer): ImageInspection {
  const kind = classifyProviderBytes(buffer);
  if (kind === "empty" || buffer.length < 67) {
    throw new BadRequestException("Provider returned an empty or truncated image");
  }
  if (kind !== "png") {
    const detail: Record<ProviderPayloadKind, string> = {
      jpeg: "Background removal provider returned JPEG instead of PNG — the subject was not isolated (likely a stub/passthrough or a misconfigured provider)",
      webp: "Background removal provider returned WebP instead of PNG",
      heic: "Background removal provider returned HEIC instead of PNG",
      gif: "Background removal provider returned GIF instead of PNG",
      json: "Background removal provider returned a JSON error payload instead of an image",
      html: "Background removal provider returned an HTML error page instead of an image",
      unknown: "Provider output is not a valid PNG",
      empty: "Provider returned an empty or truncated image",
      png: "", // unreachable
    };
    throw new BadRequestException(detail[kind]);
  }
  const info = inspectImage(buffer);
  if (!info || info.mime !== "image/png") throw new BadRequestException("Provider output is not a valid PNG");
  if (!info.hasAlpha) throw new BadRequestException("Provider output has no alpha channel — background was not removed");
  if (info.width != null && info.height != null && info.width * info.height > MAX_PIXELS) {
    throw new BadRequestException("Provider output resolution is implausibly large");
  }
  return info;
}
