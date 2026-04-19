import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { UploadsService } from "../uploads/uploads.service";

export interface RemoveBackgroundResponse {
  url: string;
}

@Injectable()
export class ImagesService {
  constructor(
    private readonly configService: ConfigService,
    private readonly uploadsService: UploadsService,
  ) {}

  /**
   * Remove background from an image using remove.bg API
   */
  async removeBackground(
    imageBuffer: Buffer,
    filename: string,
    mimetype: string,
  ): Promise<RemoveBackgroundResponse> {
    const apiKey = this.configService.get<string>("REMOVE_BG_API_KEY");

    if (!apiKey) {
      throw new ServiceUnavailableException(
        "Background removal service is not available. REMOVE_BG_API_KEY is not configured.",
      );
    }

    // Call remove.bg API
    const formData = new FormData();
    formData.append(
      "image_file",
      new Blob([new Uint8Array(imageBuffer)], { type: mimetype }),
    );
    formData.append("size", "auto");

    let response: Response;
    try {
      response = await fetch("https://api.remove.bg/v1.0/removebg", {
        method: "POST",
        headers: {
          "X-Api-Key": apiKey,
        },
        body: formData,
      });
    } catch (error) {
      throw new ServiceUnavailableException(
        `Failed to connect to background removal service: ${(error as Error).message}`,
      );
    }

    if (!response.ok) {
      const errorBody = await response.text();
      throw new ServiceUnavailableException(
        `Background removal service returned an error: ${response.status} ${errorBody}`,
      );
    }

    // Get the processed image as binary
    const processedBuffer = Buffer.from(await response.arrayBuffer());

    // Upload the processed image
    const uploadResponse = await this.uploadsService.uploadFile(
      processedBuffer,
      `no-bg-${filename}`,
      "image/png",
    );

    return {
      url: uploadResponse.url,
    };
  }
}
