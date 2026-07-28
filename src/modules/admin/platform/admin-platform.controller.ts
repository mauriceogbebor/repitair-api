import { BadRequestException, Body, Controller, Get, Param, Put, Req, UseGuards } from "@nestjs/common";
import type { AdminRequest } from "../admin.types";
import { AdminPermissions } from "../decorators/admin-permissions.decorator";
import { AdminJwtAuthGuard } from "../guards/admin-jwt-auth.guard";
import { AdminRbacGuard } from "../guards/admin-rbac.guard";
import { AdminAuditLogsService } from "../audit-logs/admin-audit-logs.service";
import { PlatformService } from "../../platform/platform.service";
import { IncidentBanner } from "../../../entities/platform-setting.entity";
import {
  AdminFeatureFlagDto,
  AdminIncidentDto,
  AdminMaintenanceDto,
  AdminUpdateVersionsDto,
} from "./dto/admin-platform.dto";

@Controller("admin/platform")
@UseGuards(AdminJwtAuthGuard, AdminRbacGuard)
export class AdminPlatformController {
  constructor(
    private readonly platformService: PlatformService,
    private readonly auditLogsService: AdminAuditLogsService,
  ) {}

  @Get("settings")
  @AdminPermissions("platform.read")
  async getSettings() {
    return this.platformService.getSettings();
  }

  @Get("flags")
  @AdminPermissions("platform.read")
  async getFlags() {
    return this.platformService.getFlags();
  }

  @Get("health")
  @AdminPermissions("platform.read")
  async getHealth() {
    return this.platformService.getHealth();
  }

  @Put("versions")
  @AdminPermissions("platform.write")
  async updateVersions(@Body() dto: AdminUpdateVersionsDto, @Req() req: AdminRequest) {
    const saved = await this.platformService.updateVersions(dto, req.adminUser?.email);
    await this.audit(req, "admin.platform.versions.updated", { ...dto });
    return saved;
  }

  @Put("maintenance")
  @AdminPermissions("platform.write")
  async setMaintenance(@Body() dto: AdminMaintenanceDto, @Req() req: AdminRequest) {
    const saved = await this.platformService.setMaintenance(dto, req.adminUser?.email);
    await this.audit(req, "admin.platform.maintenance.updated", { enabled: dto.enabled });
    return saved;
  }

  @Put("incident")
  @AdminPermissions("platform.write")
  async setIncident(@Body() dto: AdminIncidentDto, @Req() req: AdminRequest) {
    let banner: IncidentBanner | null = null;
    if (dto.active) {
      if (!dto.title || !dto.message) {
        throw new BadRequestException("An active incident banner requires a title and message.");
      }
      banner = {
        title: dto.title,
        message: dto.message,
        severity: dto.severity ?? "info",
        startsAt: dto.startsAt ?? null,
        expiresAt: dto.expiresAt ?? null,
      };
    }
    const saved = await this.platformService.setIncident(banner, req.adminUser?.email);
    await this.audit(req, "admin.platform.incident.updated", { active: Boolean(dto.active) });
    return saved;
  }

  @Put("flags/:key")
  @AdminPermissions("platform.write")
  async setFlag(@Param("key") key: string, @Body() dto: AdminFeatureFlagDto, @Req() req: AdminRequest) {
    const saved = await this.platformService.setFlag(key, dto.enabled, req.adminUser?.email);
    await this.audit(req, "admin.platform.flag.updated", { key, enabled: dto.enabled });
    return saved;
  }

  private async audit(req: AdminRequest, action: string, metadata: Record<string, unknown>) {
    await this.auditLogsService.append({
      action,
      actor: req.adminUser,
      context: req.adminRequestContext,
      targetType: "platform_setting",
      targetId: "singleton",
      metadata,
    });
  }
}
