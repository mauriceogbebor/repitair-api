import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";

import { CurrentUser, CurrentUserPayload } from "../../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { ParseLinkDto } from "./dto/parse-link.dto";
import { MusicService } from "./music.service";

@Controller("music")
@UseGuards(JwtAuthGuard)
export class MusicController {
  constructor(private musicService: MusicService) {}

  @Post("parse-link")
  async parseLink(@Body() body: ParseLinkDto) {
    // First check if it's an album/playlist — return type info so frontend knows to show picker
    const linkType = this.musicService.detectLinkType(body.link);
    if (linkType !== 'track') {
      const result = await this.musicService.listAlbumTracks(body.link);
      if (result) {
        return { type: result.type, name: result.name, tracks: result.tracks };
      }
    }
    // Single track
    const track = await this.musicService.parseLink(body.link);
    return { type: 'track', ...track };
  }

  @Get("search")
  async search(@Query("q") query: string, @CurrentUser() user: CurrentUserPayload) {
    return this.musicService.search(query);
  }

  @Get("recent")
  getRecentSongs(@CurrentUser() user: CurrentUserPayload) {
    return this.musicService.getRecentSongs(user.sub);
  }
}
