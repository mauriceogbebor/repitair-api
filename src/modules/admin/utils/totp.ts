import { createHmac, timingSafeEqual } from "crypto";

function normalizeBase32(input: string): string {
  return input.toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "");
}

function decodeBase32(secret: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = normalizeBase32(secret);
  let bits = "";

  for (const char of normalized) {
    const value = alphabet.indexOf(char);
    if (value === -1) {
      throw new Error("Invalid base32 character in MFA secret");
    }
    bits += value.toString(2).padStart(5, "0");
  }

  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }

  return Buffer.from(bytes);
}

function generateTotpCode(secret: string, counter: number, digits = 6): string {
  const key = decodeBase32(secret);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));

  const hmac = createHmac("sha1", key).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return (code % 10 ** digits).toString().padStart(digits, "0");
}

export function verifyTotpCode(options: {
  secret: string;
  code: string;
  window?: number;
  stepSeconds?: number;
  digits?: number;
  now?: number;
}): boolean {
  const {
    secret,
    code,
    window = 1,
    stepSeconds = 30,
    digits = 6,
    now = Date.now(),
  } = options;

  if (!/^\d+$/.test(code)) {
    return false;
  }

  const currentCounter = Math.floor(now / 1000 / stepSeconds);
  const normalizedCode = code.padStart(digits, "0");

  for (let offset = -window; offset <= window; offset += 1) {
    const expectedCode = generateTotpCode(secret, currentCounter + offset, digits);
    const expectedBuffer = Buffer.from(expectedCode);
    const candidateBuffer = Buffer.from(normalizedCode);

    if (
      expectedBuffer.length === candidateBuffer.length &&
      timingSafeEqual(expectedBuffer, candidateBuffer)
    ) {
      return true;
    }
  }

  return false;
}
