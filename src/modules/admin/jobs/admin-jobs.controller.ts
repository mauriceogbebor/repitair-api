import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { IsOptional, IsString, MaxLength } from "class-validator";
import type { AdminRequest } from "../admin.types";
import { AdminPermissions } from "../decorators/admin-permissions.decorator";
import { AdminJwtAuthGuard } from "../guards/admin-jwt-auth.guard";
import { AdminRbacGuard } from "../guards/admin-rbac.guard";
import { AdminAuditLogsService } from "../audit-logs/admin-audit-logs.service";
import { PlatformJobsService } from "../../platform-jobs/platform-jobs.service";
import type { PlatformJobStatus } from "../../../entities/platform-job.entity";

class ReasonBody { @IsString() @MaxLength(500) reason!: string; }
class OptionalReasonBody { @IsOptional() @IsString() @MaxLength(500) reason?: string; }

/**
 * Operations → Jobs. Read + operational control over the shared job system.
 * Payload VALUES are never returned (only keys) — export contents / tokens /
 * PII must not be exposed here. Manual retry/cancel require a reason and audit.
 */
@Controller("admin/jobs")
@UseGuards(AdminJwtAuthGuard, AdminRbacGuard)
export class AdminJobsController {
  constructor(
    private readonly jobs: PlatformJobsService,
    private readonly auditLogs: AdminAuditLogsService,
  ) {}

  @Get("overview")
  @AdminPermissions("jobs.view")
  overview() {
    return this.jobs.overview();
  }

  @Get("worker-health")
  @AdminPermissions("jobs.view")
  workerHealth() {
    return this.jobs.workerHealth();
  }

  @Get()
  @AdminPermissions("jobs.view")
  list(
    @Query("queue") queue?: string,
    @Query("type") type?: string,
    @Query("domain") domain?: string,
    @Query("status") status?: PlatformJobStatus,
    @Query("search") search?: string,
    @Query("page") page?: string,
  ) {
    return this.jobs.list({ queue, type, domain, status, search, page: page ? Number(page) : 1 });
  }

  @Get(":id")
  @AdminPermissions("jobs.view")
  detail(@Param("id") id: string) {
    return this.jobs.detail(id);
  }

  @Post(":id/retry")
  @AdminPermissions("jobs.retry")
  async retry(@Param("id") id: string, @Body() body: ReasonBody, @Req() req: AdminRequest) {
    const before = await this.jobs.requireJob(id);
    const job = await this.jobs.retry(id, req.adminUser?.email);
    await this.auditLogs.append({
      action: "admin.jobs.retried", actor: req.adminUser, context: req.adminRequestContext,
      targetType: "platform_job", targetId: id,
      beforeState: { status: before.status, attempts: before.attempts },
      afterState: { status: job.status },
      metadata: { reason: body.reason, correlationId: job.correlationId ?? null },
    });
    return this.jobs.detail(id);
  }

  @Post(":id/cancel")
  @AdminPermissions("jobs.cancel")
  async cancel(@Param("id") id: string, @Body() body: ReasonBody, @Req() req: AdminRequest) {
    const before = await this.jobs.requireJob(id);
    const job = await this.jobs.cancel(id, req.adminUser?.email, body.reason);
    await this.auditLogs.append({
      action: "admin.jobs.cancelled", actor: req.adminUser, context: req.adminRequestContext,
      targetType: "platform_job", targetId: id,
      beforeState: { status: before.status }, afterState: { status: job.status },
      metadata: { reason: body.reason, correlationId: job.correlationId ?? null },
    });
    return this.jobs.detail(id);
  }
}
