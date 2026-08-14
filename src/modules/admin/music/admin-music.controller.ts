import { Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { MusicProviderName } from "../../../entities";
import type { AdminRequest } from "../admin.types";
import { AdminAuditLogsService } from "../audit-logs/admin-audit-logs.service";
import { AdminPermissions } from "../decorators/admin-permissions.decorator";
import { AdminJwtAuthGuard } from "../guards/admin-jwt-auth.guard";
import { AdminRbacGuard } from "../guards/admin-rbac.guard";
import { AdminMusicService } from "./admin-music.service";
import {
  AdminListMusicConnectionsQueryDto,
  AdminMusicConnectionParamsDto,
  AdminMusicUserParamsDto,
} from "./dto/admin-music-query.dto";

@Controller("admin/music")
@UseGuards(AdminJwtAuthGuard, AdminRbacGuard)
export class AdminMusicController {
  constructor(
    private readonly music: AdminMusicService,
    private readonly auditLogs: AdminAuditLogsService,
  ) {}

  @Get("overview")
  @AdminPermissions("music.read")
  overview() {
    return this.music.overview();
  }

  @Get("connections")
  @AdminPermissions("music.read")
  list(@Query() query: AdminListMusicConnectionsQueryDto) {
    return this.music.list(query);
  }

  @Get("users/:userId")
  @AdminPermissions("music.read")
  userDetail(@Param() params: AdminMusicUserParamsDto) {
    return this.music.userDetail(params.userId);
  }

  @Post("users/:userId/:provider/require-reauth")
  @AdminPermissions("music.manage")
  async requireReauthorization(
    @Param() params: AdminMusicConnectionParamsDto,
    @Req() request: AdminRequest,
  ) {
    const result = await this.music.requireReauthorization(
      params.userId,
      params.provider as MusicProviderName,
    );
    await this.auditLogs.append({
      action: "admin.music.reauthorization_required",
      actor: request.adminUser,
      context: request.adminRequestContext,
      targetType: "music_connection",
      targetId: result.targetId,
      beforeState: { status: result.before.status },
      afterState: { status: result.connection.status },
      metadata: { userId: params.userId, provider: params.provider },
    });
    return result.connection;
  }

  @Delete("users/:userId/:provider")
  @AdminPermissions("music.manage")
  async disconnect(
    @Param() params: AdminMusicConnectionParamsDto,
    @Req() request: AdminRequest,
  ) {
    const result = await this.music.disconnect(params.userId, params.provider as MusicProviderName);
    await this.auditLogs.append({
      action: "admin.music.disconnected",
      actor: request.adminUser,
      context: request.adminRequestContext,
      targetType: "music_connection",
      targetId: result.targetId,
      beforeState: { status: result.before.status },
      afterState: { status: "disconnected" },
      metadata: { userId: params.userId, provider: params.provider },
    });
    return {
      disconnected: true,
      userId: result.userId,
      provider: result.provider,
    };
  }
}
