import { Body, Controller, Get, Param, ParseBoolPipe, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { CurrentUser, CurrentUserPayload } from "../../common/decorators/current-user.decorator";
import { MediaProcessingService } from "./media-processing.service";
import { RegisterMediaAssetDto } from "./dto/register-media-asset.dto";

/**
 * Consumer media API. Templates never see providers or processing internals —
 * they consume the asset the backend selects (transparent derivative when ready,
 * else original). Processing is enqueued, never run in the request.
 */
@Controller("media")
@UseGuards(JwtAuthGuard)
export class MediaController {
  constructor(private readonly media: MediaProcessingService) {}

  /** Register an already-uploaded image as a processable asset. */
  @Post("assets")
  async register(@CurrentUser() user: CurrentUserPayload, @Body() dto: RegisterMediaAssetDto) {
    return this.media.register({ ...dto, ownerUserId: user.sub });
  }

  /** Queue background removal (asynchronous — via the Platform Job System). */
  @Post("assets/:id/process")
  async process(@CurrentUser() user: CurrentUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    await this.media.assertOwnership(id, user.sub);
    return this.media.enqueueProcessing(id);
  }

  /** Retry a failed attempt. */
  @Post("assets/:id/retry")
  async retry(@CurrentUser() user: CurrentUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    await this.media.assertOwnership(id, user.sub);
    return this.media.retry(id);
  }

  /** Processing status + which asset the template should use. */
  @Get("assets/:id")
  async status(@CurrentUser() user: CurrentUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    await this.media.assertOwnership(id, user.sub);
    return this.media.status(id);
  }

  /**
   * Resolve the image a template should render. The client passes whether the
   * chosen template requires subject isolation; the backend returns the
   * transparent derivative when ready, auto-starts processing when required but
   * not ready, and NEVER substitutes the original for an isolation template.
   */
  @Get("assets/:id/for-template")
  async forTemplate(
    @CurrentUser() user: CurrentUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Query("requiresBackgroundRemoval", new ParseBoolPipe({ optional: true })) requiresBackgroundRemoval?: boolean,
  ) {
    await this.media.assertOwnership(id, user.sub);
    return this.media.resolveTemplateImage(id, Boolean(requiresBackgroundRemoval));
  }
}
