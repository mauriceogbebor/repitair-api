import { BadRequestException, Body, Controller, Get, Logger, Post, Query, UseGuards } from "@nestjs/common";

import { CurrentUser, CurrentUserPayload } from "../../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { ParseLinkDto } from "./dto/parse-link.dto";
import { MusicService } from "./music.service";

@Controller("music")
@UseGuards(JwtAuthGuard)
export class MusicController {
  private readonly logger = new Logger(MusicController.name);

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
      // listAlbumTracks returned null — the API call failed for this album/playlist link.
      // Don't fall through to parseLink (it would try to extract a track ID from an album URL).
      this.logger.warn(`listAlbumTracks returned null for ${linkType} link: ${body.link}`);
      throw new BadRequestException(
        `We couldn't load tracks from that ${linkType}. Please check the link and try again.`,
      );
    }
    // Single track
    const track = await this.musicService.parseLink(body.link);
    return { type: 'track', ...track };
  }

  @Get("search")
  async search(
    @Query("q") query: string,
    @Query("platform") platform?: "spotify" | "apple-music",
    @Query("storefront") storefront?: string,
  ) {
    return this.musicService.search(query, platform, storefront);
  }

  @Get("recent")
  getRecentSongs(@CurrentUser() user: CurrentUserPayload) {
    return this.musicService.getRecentSongs(user.sub);
  }
}
