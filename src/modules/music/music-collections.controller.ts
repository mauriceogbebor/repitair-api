import { Controller, Get, Param } from "@nestjs/common";

import { MusicLibraryService } from "./music-library.service";

@Controller("music/shared-collections")
export class MusicCollectionsController {
  constructor(private readonly library: MusicLibraryService) {}

  @Get(":shareCode")
  getCollection(@Param("shareCode") shareCode: string) {
    return this.library.getSharedCollection(shareCode);
  }
}
