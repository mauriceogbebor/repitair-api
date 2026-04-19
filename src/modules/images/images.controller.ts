import {
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  NotFoundException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { ImagesService, RemoveBackgroundResponse } from "./images.service";

@Controller("images")
export class ImagesController {
  constructor(private readonly imagesService: ImagesService) {}

  /**
   * Remove background from an image (requires auth).
   */
  @Post("remove-background")
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 5 * 1024 * 1024 } }))
  async removeBackground(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<RemoveBackgroundResponse> {
    if (!file) {
      throw new NotFoundException("No file provided");
    }

    return this.imagesService.removeBackground(
      file.buffer,
      file.originalname,
      file.mimetype,
    );
  }
}
