import { Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { AdminRequest } from "../admin.types";
import { AdminPermissions } from "../decorators/admin-permissions.decorator";
import { AdminJwtAuthGuard } from "../guards/admin-jwt-auth.guard";
import { AdminRbacGuard } from "../guards/admin-rbac.guard";
import { AdminAuditLogsService } from "../audit-logs/admin-audit-logs.service";
import { AdminMediaService } from "./admin-media.service";

@Controller("admin/media")
@UseGuards(AdminJwtAuthGuard, AdminRbacGuard)
export class AdminMediaController {
  constructor(
    private readonly media: AdminMediaService,
    private readonly auditLogs: AdminAuditLogsService,
  ) {}

  /** Best-effort processing status of an asset for before/after audit state. */
  private async statusOf(id: string): Promise<string | null> {
    try {
      const detail = await this.media.inspect(id);
      return (detail as { processingStatus?: string } | null)?.processingStatus ?? null;
    } catch {
      return null;
    }
  }

  @Get("overview")
  @AdminPermissions("media.read")
  overview() {
    return this.media.overview();
  }

  @Get("assets")
  @AdminPermissions("media.read")
  list(
    @Query("status") status?: string,
    @Query("provider") provider?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.media.list({ status, provider, from, to, page: page ? Number(page) : undefined, pageSize: pageSize ? Number(pageSize) : undefined });
  }

  @Get("assets/:id")
  @AdminPermissions("media.read")
  inspect(@Param("id", ParseUUIDPipe) id: string) {
    return this.media.inspect(id);
  }

  @Post("assets/:id/retry")
  @AdminPermissions("media.manage")
  async retry(@Param("id", ParseUUIDPipe) id: string, @Req() req: AdminRequest) {
    const before = await this.statusOf(id);
    const result = await this.media.retry(id);
    await this.auditLogs.append({
      action: "admin.media.retried", actor: req.adminUser, context: req.adminRequestContext,
      targetType: "media_asset", targetId: id,
      beforeState: { processingStatus: before },
      afterState: { processingStatus: (result as { processingStatus?: string } | null)?.processingStatus ?? null },
    });
    return result;
  }

  @Post("assets/:id/regenerate")
  @AdminPermissions("media.manage")
  async regenerate(@Param("id", ParseUUIDPipe) id: string, @Req() req: AdminRequest) {
    const before = await this.statusOf(id);
    const result = await this.media.regenerate(id);
    await this.auditLogs.append({
      action: "admin.media.regenerated", actor: req.adminUser, context: req.adminRequestContext,
      targetType: "media_asset", targetId: id,
      beforeState: { processingStatus: before },
      afterState: { processingStatus: (result as { processingStatus?: string } | null)?.processingStatus ?? null },
    });
    return result;
  }
}
