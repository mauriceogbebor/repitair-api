import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpException, Param, Post, Query, Req, ServiceUnavailableException, UseGuards } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { IsEmail, IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { AdminUser } from "../../../entities/admin-user.entity";
import type { AdminRequest } from "../admin.types";
import { AdminPermissions } from "../decorators/admin-permissions.decorator";
import { AdminJwtAuthGuard } from "../guards/admin-jwt-auth.guard";
import { AdminRbacGuard } from "../guards/admin-rbac.guard";
import { PrivacyWorkflowService, TransitionContext } from "../../privacy/privacy-workflow.service";
import { PrivacyQueryService } from "../../privacy/privacy-query.service";
import { PrivacyService } from "../../privacy/privacy.service";
import { PlatformJobsService } from "../../platform-jobs/platform-jobs.service";
import type { PrivacyRequestStatus, PrivacyRequestType, VerificationStatus } from "../../../entities/privacy-request.entity";

class AssignDto { @IsEmail() toEmail!: string; }
class ReasonDto { @IsString() @MaxLength(1000) reason!: string; }
class OptionalReasonDto { @IsOptional() @IsString() @MaxLength(1000) reason?: string; }
class FulfilDto {
  @IsString() @MaxLength(120) method!: string;
  @IsString() @MaxLength(120) result!: string;
  @IsIn(["verified", "failed"]) verificationStatus!: VerificationStatus;
  @IsOptional() @IsString() @MaxLength(2000) internalNotes?: string;
}

@Controller("admin/privacy")
@UseGuards(AdminJwtAuthGuard, AdminRbacGuard)
export class AdminPrivacyController {
  constructor(
    private readonly workflow: PrivacyWorkflowService,
    private readonly queries: PrivacyQueryService,
    private readonly legacy: PrivacyService,
    private readonly platformJobs: PlatformJobsService,
    @InjectRepository(AdminUser) private readonly adminUsers: Repository<AdminUser>,
  ) {}

  private static readonly ASSIGNABLE: string[] = [
    "pending",
    "assigned",
    "in_review",
    "approved",
    "processing",
    "retry_required",
  ];
  private static readonly ASSIGNEE_PERMISSION = "privacy.process";

  @Get("assignees")
  @AdminPermissions("privacy.assign")
  async assignees() {
    return this.listEligibleAssignees();
  }

  private async listEligibleAssignees() {
    const admins = await this.adminUsers.find({ where: { status: "active" }, relations: { roles: { permissions: true } } });
    return admins
      .filter((a) => a.roles?.some((r) => r.permissions?.some((p) => p.key === AdminPrivacyController.ASSIGNEE_PERMISSION)))
      .map((a) => ({ id: a.id, email: a.email }));
  }

  private async isEligibleAssignee(email: string): Promise<boolean> {
    const admin = await this.adminUsers.findOne({ where: { email, status: "active" }, relations: { roles: { permissions: true } } });
    return Boolean(admin?.roles?.some((r) => r.permissions?.some((p) => p.key === AdminPrivacyController.ASSIGNEE_PERMISSION)));
  }

  private ctx(req: AdminRequest): TransitionContext {
    return { actor: req.adminUser, requestContext: req.adminRequestContext };
  }

  // ── Reads ────────────────────────────────────────────────────────────────
  @Get("overview")
  @AdminPermissions("privacy.view")
  overview() {
    return this.queries.overview();
  }

  @Get("requests")
  @AdminPermissions("privacy.view")
  list(
    @Query("status") status?: PrivacyRequestStatus,
    @Query("type") type?: PrivacyRequestType,
    @Query("assignedAdminEmail") assignedAdminEmail?: string,
    @Query("search") search?: string,
    @Query("page") page?: string,
  ) {
    return this.queries.list({ status, type, assignedAdminEmail, search, page: page ? Number(page) : 1 });
  }

  @Get("requests/:id")
  @AdminPermissions("privacy.view")
  detail(@Param("id") id: string) {
    return this.queries.detail(id);
  }

  @Get("deletions")
  @AdminPermissions("privacy.view")
  legacyDeletions(@Query("status") status?: "pending" | "in_progress" | "completed" | "rejected") {
    return this.legacy.listDeletions(status);
  }

  // ── Assignment ─────────────────────────────────────────────────────────────
  @Post("requests/:id/assign")
  @AdminPermissions("privacy.assign")
  async assign(@Param("id") id: string, @Body() dto: AssignDto, @Req() req: AdminRequest) {
    const { request } = await this.queries.detail(id);
    if (!AdminPrivacyController.ASSIGNABLE.includes(request.status)) {
      throw new BadRequestException("This request is not in an assignable state.");
    }
    if (!(await this.isEligibleAssignee(dto.toEmail))) {
      throw new BadRequestException("Assignee must be an active administrator holding the privacy.process permission.");
    }
    await this.workflow.assign(id, dto.toEmail, this.ctx(req));
    return this.queries.detail(id);
  }

  // ── Review / approval flow ──────────────────────────────────────────────
  @Post("requests/:id/review")
  @AdminPermissions("privacy.process")
  async review(@Param("id") id: string, @Req() req: AdminRequest) {
    await this.workflow.transition(id, "in_review", this.ctx(req));
    return this.queries.detail(id);
  }

  @Post("requests/:id/approve")
  @AdminPermissions("privacy.process")
  async approve(@Param("id") id: string, @Req() req: AdminRequest) {
    await this.workflow.transition(id, "approved", this.ctx(req));
    return this.queries.detail(id);
  }

  @Post("requests/:id/reject")
  @AdminPermissions("privacy.reject")
  async reject(@Param("id") id: string, @Body() dto: ReasonDto, @Req() req: AdminRequest) {
    await this.workflow.transition(id, "rejected", { ...this.ctx(req), reason: dto.reason });
    return this.queries.detail(id);
  }

  @Post("requests/:id/cancel")
  @AdminPermissions("privacy.process")
  async cancel(@Param("id") id: string, @Body() dto: OptionalReasonDto, @Req() req: AdminRequest) {
    await this.workflow.transition(id, "cancelled", { ...this.ctx(req), reason: dto.reason ?? null });
    return this.queries.detail(id);
  }

  // ── Execution (fulfilment) ──────────────────────────────────────────────
  @Post("requests/:id/process")
  @AdminPermissions("privacy.process")
  async process(@Param("id") id: string, @Req() req: AdminRequest) {
    const { request } = await this.queries.detail(id);
    if (request.status !== "approved") throw new BadRequestException("Request must be approved before processing.");
    this.assertOperationPermission(request.type, req);
    if (this.hasAutomatedExecutor(request.type)) {
      // The transition and durable platform job commit in one transaction.
      await this.startExecution(request.type, id, request.userId, req);
    } else {
      // Access, correction, and other requests are fulfilled manually. Moving
      // them to processing unlocks the existing evidence-recording endpoint.
      await this.workflow.transition(id, "processing", this.ctx(req));
    }
    return this.queries.detail(id);
  }

  @Post("requests/:id/retry")
  @AdminPermissions("privacy.process")
  async retry(@Param("id") id: string, @Req() req: AdminRequest) {
    const { request } = await this.queries.detail(id);
    this.assertOperationPermission(request.type, req);
    if (request.status === "failed") await this.workflow.transition(id, "retry_required", this.ctx(req));
    if (this.hasAutomatedExecutor(request.type)) {
      await this.startExecution(request.type, id, request.userId, req);
    } else {
      await this.workflow.transition(id, "processing", this.ctx(req));
    }
    return this.queries.detail(id);
  }

  private hasAutomatedExecutor(type: PrivacyRequestType): boolean {
    return type === "account_deletion" || type === "data_export";
  }

  /**
   * Transition → processing and durable enqueue commit atomically. If enqueue
   * fails, the transaction rolls back and the request remains actionable.
   */
  private async startExecution(type: PrivacyRequestType, id: string, userId: string, req: AdminRequest) {
    try {
      await this.workflow.transitionWith(
        id,
        "processing",
        this.ctx(req),
        (manager) => this.enqueuePrivacyJob(manager, type, id, userId, req),
      );
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new ServiceUnavailableException(
        "Execution service unavailable — the job could not be enqueued. No destructive work began and the request remains actionable.",
      );
    }
  }

  /** Destructive operations require operation-specific permissions (not just process). */
  private assertOperationPermission(type: PrivacyRequestType, req: AdminRequest) {
    const keys = req.adminUser?.permissionKeys ?? [];
    if (type === "data_export" && !keys.includes("privacy.export")) {
      throw new ForbiddenException("privacy.export is required to execute a data export.");
    }
    if (type === "account_deletion" && !keys.includes("privacy.delete")) {
      throw new ForbiddenException("privacy.delete is required to execute an account deletion.");
    }
  }

  /** Manual fulfilment for request types without an automated executor. */
  @Post("requests/:id/fulfil")
  @AdminPermissions("privacy.process")
  async fulfil(@Param("id") id: string, @Body() dto: FulfilDto, @Req() req: AdminRequest) {
    await this.workflow.recordFulfilment(id, dto, this.ctx(req));
    return this.queries.detail(id);
  }

  @Post("requests/:id/complete")
  @AdminPermissions("privacy.complete")
  async complete(@Param("id") id: string, @Req() req: AdminRequest) {
    await this.workflow.transition(id, "completed", this.ctx(req));
    return this.queries.detail(id);
  }

  /**
   * Enqueue the privacy execution onto the shared Platform Job System. The
   * Privacy Worker runs the executor asynchronously; nothing executes inside
   * this HTTP request. On queue unavailability we surface 503 and change nothing.
   */
  private async enqueuePrivacyJob(
    manager: EntityManager,
    type: PrivacyRequestType,
    id: string,
    userId: string,
    req: AdminRequest,
  ) {
    const jobType =
      type === "account_deletion" ? "privacy.account_deletion" : type === "data_export" ? "privacy.data_export" : null;
    if (!jobType) {
      throw new BadRequestException(`No automated executor for request type "${type}" — record fulfilment manually.`);
    }
    const prefix = type === "account_deletion" ? "privacy-delete" : "privacy-export";
    await this.platformJobs.enqueueWithManager(manager, {
      type: jobType,
      payload: { privacyRequestId: id, userId },
      priority: "high",
      idempotencyKey: `${prefix}:${id}`,
      correlationId: id,
      createdBy: req.adminUser?.email ?? undefined,
    });
  }
}
