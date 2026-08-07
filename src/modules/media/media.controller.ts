import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { CurrentUser, CurrentUserPayload } from "../../common/decorators/current-user.decorator";
import { MediaProcessingService } from "./media-processing.service";
import { RegisterMediaAssetDto } from "./dto/register-media-asset.dto";
import { ResolveTemplateMediaDto } from "./dto/resolve-template-media.dto";
import { LinkMediaRepitDto } from "./dto/link-media-repit.dto";

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

  /** Processing status + which asset the template should use. */
  @Get("assets/:id")
  async status(@CurrentUser() user: CurrentUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    await this.media.assertOwnership(id, user.sub);
    return this.media.status(id);
  }

  /** Resolve media using the selected template's published backend capability. */
  @Post("assets/:id/resolve-template")
  async resolveTemplate(
    @CurrentUser() user: CurrentUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ResolveTemplateMediaDto,
  ) {
    await this.media.assertOwnership(id, user.sub);
    return this.media.resolveTemplateImage(id, dto.templateId, { purpose: dto.purpose });
  }

  /** Explicit creator retry; still governed by the published template capability. */
  @Post("assets/:id/resolve-template/retry")
  async retryTemplate(
    @CurrentUser() user: CurrentUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ResolveTemplateMediaDto,
  ) {
    await this.media.assertOwnership(id, user.sub);
    return this.media.resolveTemplateImage(id, dto.templateId, { autoStart: true, retryFailed: true, purpose: dto.purpose });
  }

  /** Attach the finished creation record for end-to-end operational tracing. */
  @Post("assets/:id/link-repit")
  async linkRepit(
    @CurrentUser() user: CurrentUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: LinkMediaRepitDto,
  ) {
    await this.media.assertOwnership(id, user.sub);
    return this.media.linkRepit(id, dto.repitId, dto.templateId, user.sub);
  }
}
