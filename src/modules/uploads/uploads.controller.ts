import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Response } from "express";
import * as fs from "fs";
import * as path from "path";

import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { UploadsService } from "./uploads.service";
import { UploadResponseDto } from "./dto/upload-response.dto";

@Controller("uploads")
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  /**
   * Upload an image file (requires auth).
   */
  @Post("image")
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 5 * 1024 * 1024 } }))
  async uploadImage(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<UploadResponseDto> {
    if (!file) {
      throw new NotFoundException("No file provided");
    }

    return this.uploadsService.uploadFile(
      file.buffer,
      file.originalname,
      file.mimetype,
    );
  }

  /**
   * Serve uploaded files (public, no auth required).
   */
  @Get(":filename")
  async serveFile(
    @Param("filename") filename: string,
    @Res() res: Response,
  ) {
    // Sanitize filename to prevent directory traversal
    const sanitized = path.basename(filename);
    const uploadsDir = path.resolve(process.cwd(), "data", "uploads");
    const filepath = path.join(uploadsDir, sanitized);

    // Defense in depth: ensure the resolved path is still inside uploadsDir.
    if (!filepath.startsWith(uploadsDir + path.sep)) {
      throw new NotFoundException("File not found");
    }

    if (!fs.existsSync(filepath)) {
      throw new NotFoundException("File not found");
    }

    const ext = path.extname(sanitized).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
      ".gif": "image/gif",
    };

    const contentType = mimeTypes[ext] ?? "application/octet-stream";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

    const stream = fs.createReadStream(filepath);
    stream.pipe(res);
  }
}
