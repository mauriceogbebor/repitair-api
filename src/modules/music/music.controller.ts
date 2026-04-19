import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";

import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { ParseLinkDto } from "./dto/parse-link.dto";
import { MusicService } from "./music.service";

@Controller("music")
@UseGuards(JwtAuthGuard)
export class MusicController {
  constructor(private musicService: MusicService) {}

  @Post("parse-link")
  async parseLink(@Body() body: ParseLinkDto) {
    return this.musicService.parseLink(body.link);
  }

  @Get("recent")
  getRecentSongs() {
    return this.musicService.getRecentSongs();
  }
}
