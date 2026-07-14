import { Body, Controller, Get, Logger, Post, Query, Res, UseGuards } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Response } from "express";

import { CurrentUser, CurrentUserPayload } from "../../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { MusicResolutionException, UpstreamMusicError } from "./music.errors";
import { ParseLinkDto } from "./dto/parse-link.dto";
import { MusicService } from "./music.service";

@Controller("music")
@UseGuards(JwtAuthGuard)
export class MusicController {
  private readonly logger = new Logger(MusicController.name);

  constructor(private musicService: MusicService) {}

  @Post("parse-link")
  async parseLink(
    @Body() body: ParseLinkDto,
    @CurrentUser() user: CurrentUserPayload,
    @Res({ passthrough: true }) response: Response,
  ) {
    const requestId = response.req.header("x-client-request-id")?.trim() || randomUUID();
    response.setHeader("x-request-id", requestId);
    const startedAt = Date.now();

    let provider: string = "unknown";
    let lookupType: string = "unknown";
    let result: "success" | "error" = "success";
    let statusCode = 200;
    let errorCode: string | null = null;

    try {
      const prepared = await this.musicService.prepareLink(body.link, requestId, user.sub);
      provider = prepared.provider;
      lookupType = prepared.linkType;

      if (prepared.linkType !== "track") {
        const collection = await this.musicService.listAlbumTracks(prepared.normalizedUrl, user.sub, requestId);
        return { type: collection.type, name: collection.name, tracks: collection.tracks };
      }

      const track = await this.musicService.parseLink(prepared.normalizedUrl, requestId);
      return { type: "track", ...track };
    } catch (error) {
      result = "error";
      if (error instanceof MusicResolutionException) {
        statusCode = error.getStatus();
        errorCode = error.code;
      } else if (error instanceof UpstreamMusicError) {
        statusCode = error.httpStatus;
        errorCode = error.code;
      } else {
        statusCode = 500;
        errorCode = "UNKNOWN";
      }
      throw error;
    } finally {
      const durationMs = Date.now() - startedAt;
      const diagnostics = this.musicService.getTokenDiagnostics(
        provider === "spotify" ? "spotify" : provider === "apple-music" ? "apple-music" : "unknown",
      );
      const telemetry = {
        requestId,
        provider,
        lookupType,
        coldStart: diagnostics.coldStart,
        tokenAgeMs: diagnostics.tokenAgeMs,
        lastTokenRefreshAgeMs: diagnostics.lastRefreshAgeMs,
        durationMs,
        result,
        statusCode,
        errorCode,
      };
      if (result === "error") {
        this.logger.warn(`parse-link ${JSON.stringify(telemetry)}`);
      } else {
        this.logger.log(`parse-link ${JSON.stringify(telemetry)}`);
      }
    }
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
