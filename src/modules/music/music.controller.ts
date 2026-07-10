import { Body, Controller, Get, Post, Query, Res, UseGuards } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Response } from "express";

import { CurrentUser, CurrentUserPayload } from "../../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { ParseLinkDto } from "./dto/parse-link.dto";
import { MusicService } from "./music.service";

@Controller("music")
@UseGuards(JwtAuthGuard)
export class MusicController {
  constructor(private musicService: MusicService) {}

  @Post("parse-link")
  async parseLink(
    @Body() body: ParseLinkDto,
    @CurrentUser() user: CurrentUserPayload,
    @Res({ passthrough: true }) response: Response,
  ) {
    const requestId = response.req.header("x-client-request-id")?.trim() || randomUUID();
    response.setHeader("x-request-id", requestId);

    const prepared = await this.musicService.prepareLink(body.link, requestId, user.sub);
    if (prepared.linkType !== "track") {
      const result = await this.musicService.listAlbumTracks(prepared.normalizedUrl, user.sub, requestId);
      return { type: result.type, name: result.name, tracks: result.tracks };
    }

    const track = await this.musicService.parseLink(prepared.normalizedUrl, requestId);
    return { type: "track", ...track };
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
