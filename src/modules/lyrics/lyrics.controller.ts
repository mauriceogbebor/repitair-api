import { Controller, Get, Query, ServiceUnavailableException } from "@nestjs/common";

import { LyricsQueryDto } from "./dto/lyrics-query.dto";
import { LyricsService } from "./lyrics.service";

@Controller("lyrics")
export class LyricsController {
  constructor(private readonly lyricsService: LyricsService) {}

  @Get("search")
  async search(@Query() query: LyricsQueryDto) {
    if (!this.lyricsService.isEnabled()) {
      // 503 lets the client tell "feature off" apart from "no match found".
      throw new ServiceUnavailableException({ enabled: false, lyrics: null });
    }
    const lyrics = await this.lyricsService.search(query.title, query.artist);
    return { enabled: true, lyrics };
  }
}
