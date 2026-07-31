import { Injectable } from "@nestjs/common";
import { UploadsService } from "../uploads/uploads.service";

/**
 * Thin adapter over the EXISTING UploadsService (local/S3). The pipeline reads
 * original bytes and writes derivatives through this gateway.
 *
 * SECURITY: reads are BY SERVER-OWNED KEY only. There is no path that fetches a
 * client-supplied or arbitrary URL, which is what eliminates the SSRF class —
 * the worker can only ever read objects the server itself issued keys for.
 */
@Injectable()
export class MediaStorageGateway {
  constructor(private readonly uploads: UploadsService) {}

  /** Read an original's bytes by its server-owned storage key (never a URL). */
  readByKey(key: string): Promise<Buffer> {
    return this.uploads.readFile(key);
  }

  /** Existence/ownership pre-check for a key before it enters the pipeline. */
  objectExists(key: string): Promise<boolean> {
    return this.uploads.objectExists(key);
  }

  healthCheck(): Promise<{ provider: "local" | "s3"; connected: boolean }> {
    return this.uploads.healthCheck();
  }

  /** Server-derived URL for a key (signed/preview URL for private buckets). */
  urlForKey(key: string): string {
    return this.uploads.urlForKey(key);
  }

  /** Store a processed derivative and return its {url, key}. */
  async storeDerivative(buffer: Buffer, mimeType: string): Promise<{ url: string; key: string }> {
    const ext = mimeType === "image/png" ? "derivative.png" : "derivative.bin";
    return this.uploads.uploadFile(buffer, ext, mimeType);
  }

  /** Delete a derivative/object by key (cleanup + retention). */
  deleteByKey(key: string): Promise<void> {
    return this.uploads.deleteFile(key);
  }
}
