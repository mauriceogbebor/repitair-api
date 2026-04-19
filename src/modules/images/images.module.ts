import { Module } from "@nestjs/common";
import { UploadsModule } from "../uploads/uploads.module";
import { ImagesController } from "./images.controller";
import { ImagesService } from "./images.service";

@Module({
  imports: [UploadsModule],
  controllers: [ImagesController],
  providers: [ImagesService],
})
export class ImagesModule {}
