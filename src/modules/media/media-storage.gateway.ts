import { Injectable } from "@nestjs/common";
import { UploadsService } from "../uploads/uploads.service";

/**
 * Thin adapter over the EXISTING UploadsService (local/S3). The pipeline reads
 * original bytes and writes derivatives through this gateway, so no upload or
 * storage-provider logic is duplicated in the media domain.
 */
@Injectable()
export class MediaStorageGateway {
  constructor(private readonly uploads: UploadsService) {}

  /** Read the bytes of an already-stored asset by its public URL. */
  async readBytes(url: string): Promise<Buffer> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to read media bytes: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }

  /** Store a processed derivative and return its {url, key}. */
  async storeDerivative(buffer: Buffer, mimeType: string): Promise<{ url: string; key: string }> {
    const ext = mimeType === "image/png" ? "derivative.png" : "derivative.bin";
    return this.uploads.uploadFile(buffer, ext, mimeType);
  }
}
