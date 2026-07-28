import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, EntityManager, In, Repository } from "typeorm";
import {
  AssignmentHistoryEntry,
  PrivacyPriority,
  PrivacyRequest,
  PrivacyRequestStatus,
  PrivacyRequestType,
  VerificationStatus,
} from "../../entities/privacy-request.entity";
import { PrivacyEvent } from "../../entities/privacy-event.entity";
import { AdminAuditLogsService } from "../admin/audit-logs/admin-audit-logs.service";
import type { AdminRequestActor, AdminRequestContext } from "../admin/admin.types";

/** Allowed status transitions. Anything not listed is rejected by the engine. */
const TRANSITIONS: Record<PrivacyRequestStatus, PrivacyRequestStatus[]> = {
  pending: ["assigned", "cancelled", "rejected", "expired"],
  assigned: ["in_review", "pending", "cancelled", "rejected"],
  in_review: ["approved", "rejected", "cancelled"],
  approved: ["processing", "cancelled"],
  processing: ["fulfilled", "failed", "cancelled"],
  fulfilled: ["completed", "failed"],
  completed: [],
  rejected: [],
  failed: ["retry_required", "cancelled"],
  retry_required: ["processing", "cancelled"],
  cancelled: [],
  expired: [],
};

const ACTIVE_STATUSES: PrivacyRequestStatus[] = [
  "pending", "assigned", "in_review", "approved", "processing", "fulfilled", "retry_required",
];

/** SLA resolution targets (hours) by request type. */
const SLA_TARGET_HOURS: Record<PrivacyRequestType, number> = {
  account_deletion: 72,
  data_export: 72,
  data_access: 168,
  data_correction: 168,
  other: 168,
};

export interface TransitionContext {
  actor?: AdminRequestActor | null;
  requestContext?: AdminRequestContext | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
}

@Injectable()
export class PrivacyWorkflowService {
  constructor(
    @InjectRepository(PrivacyRequest) private readonly requests: Repository<PrivacyRequest>,
    @InjectRepository(PrivacyEvent) private readonly events: Repository<PrivacyEvent>,
    private readonly audit: AdminAuditLogsService,
    private readonly dataSource: DataSource,
  ) {}

  static canTransition(from: PrivacyRequestStatus, to: PrivacyRequestStatus): boolean {
    return TRANSITIONS[from]?.includes(to) ?? false;
  }

  static isActive(status: PrivacyRequestStatus): boolean {
    return ACTIVE_STATUSES.includes(status);
  }

  static computeDueAt(type: PrivacyRequestType, createdAt: Date): Date {
    return new Date(createdAt.getTime() + SLA_TARGET_HOURS[type] * 3600_000);
  }

  /** SLA view derived at read time — never stored stale. */
  static slaView(request: PrivacyRequest) {
    const due = request.dueAt ? new Date(request.dueAt).getTime() : null;
    const now = Date.now();
    const remainingMs = due ? due - now : null;
    return {
      dueAt: request.dueAt ?? null,
      remainingMs,
      overdue: due != null && remainingMs != null && remainingMs < 0 && PrivacyWorkflowService.isActive(request.status),
      escalationLevel: request.escalationLevel,
      priority: request.priority,
    };
  }

  async appendEvent(requestId: string, type: string, opts: { message?: string; actorEmail?: string | null; metadata?: Record<string, unknown> | null } = {}): Promise<void> {
    await this.events.save(this.events.create({
      requestId,
      type,
      message: opts.message ?? null,
      actorEmail: opts.actorEmail ?? null,
      metadata: opts.metadata ?? null,
      at: new Date(),
    }));
  }

  async appendEventWithManager(
    manager: EntityManager,
    requestId: string,
    type: string,
    opts: { message?: string; actorEmail?: string | null; metadata?: Record<string, unknown> | null } = {},
  ): Promise<void> {
    const events = manager.getRepository(PrivacyEvent);
    await events.save(events.create({
      requestId,
      type,
      message: opts.message ?? null,
      actorEmail: opts.actorEmail ?? null,
      metadata: opts.metadata ?? null,
      at: new Date(),
    }));
  }

  async getTimeline(requestId: string): Promise<PrivacyEvent[]> {
    return this.events.find({ where: { requestId }, order: { at: "ASC" } });
  }

  private async requireWithManager(
    manager: EntityManager,
    id: string,
    lock = false,
  ): Promise<PrivacyRequest> {
    const request = await manager.getRepository(PrivacyRequest).findOne({
      where: { id },
      lock: lock ? { mode: "pessimistic_write" } : undefined,
    });
    if (!request) throw new NotFoundException("Privacy request not found");
    return request;
  }

  /** Duplicate detection: one active request per (user, type). */
  async findActiveRequest(userId: string, type: PrivacyRequestType): Promise<PrivacyRequest | null> {
    return this.requests.findOne({ where: { userId, type, status: In(ACTIVE_STATUSES) } });
  }

  async createRequest(input: { userId: string; userEmail?: string | null; type: PrivacyRequestType; priority?: PrivacyPriority; notes?: string | null }, ctx: TransitionContext = {}): Promise<PrivacyRequest> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const requests = manager.getRepository(PrivacyRequest);
        const existing = await requests.findOne({
          where: { userId: input.userId, type: input.type, status: In(ACTIVE_STATUSES) },
        });
        if (existing) {
          throw new ConflictException({
            message: "An active request of this type already exists for the user.",
            existingRequestId: existing.id,
          });
        }

        const now = new Date();
        const saved = await requests.save(requests.create({
          userId: input.userId,
          userEmail: input.userEmail ?? null,
          type: input.type,
          status: "pending",
          priority: input.priority ?? "medium",
          notes: input.notes ?? null,
          dueAt: PrivacyWorkflowService.computeDueAt(input.type, now),
        }));
        const events = manager.getRepository(PrivacyEvent);
        await events.save(events.create({
          requestId: saved.id,
          type: "submitted",
          message: `${input.type} request submitted`,
          actorEmail: ctx.actor?.email ?? input.userEmail ?? null,
          metadata: null,
          at: now,
        }));
        await this.audit.append(
          {
            action: "privacy.request.created",
            actor: ctx.actor,
            context: ctx.requestContext,
            targetType: "privacy_request",
            targetId: saved.id,
            afterState: this.snapshot(saved),
          },
          manager,
        );
        return saved;
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        const existing = await this.findActiveRequest(input.userId, input.type);
        throw new ConflictException({
          message: "An active request of this type already exists for the user.",
          existingRequestId: existing?.id ?? null,
        });
      }
      throw error;
    }
  }

  /**
   * The ONLY way a status changes. Enforces the transition table and the
   * fulfilment gate on completion.
   */
  async transition(id: string, to: PrivacyRequestStatus, ctx: TransitionContext = {}): Promise<PrivacyRequest> {
    return this.transitionWith(id, to, ctx);
  }

  /**
   * Transition with an optional transaction participant. Queue/outbox writes
   * use this hook so the domain state and durable work item commit together.
   */
  async transitionWith(
    id: string,
    to: PrivacyRequestStatus,
    ctx: TransitionContext = {},
    participate?: (manager: EntityManager, request: PrivacyRequest) => Promise<void>,
  ): Promise<PrivacyRequest> {
    return this.dataSource.transaction(async (manager) => {
      const request = await this.requireWithManager(manager, id, true);
      const from = request.status;
      if (from === to) return request;
      if (!PrivacyWorkflowService.canTransition(from, to)) {
        throw new BadRequestException(`Invalid transition: ${from} → ${to}`);
      }
      if (to === "completed" && !(request.fulfilledAt && request.verificationStatus === "verified")) {
        throw new BadRequestException("Cannot complete: fulfilment has not been recorded and verified.");
      }
      if (to === "rejected" && !ctx.reason) {
        throw new BadRequestException("A rejection reason is required.");
      }

      const before = this.snapshot(request);
      request.status = to;
      if (to === "completed") request.completedAt = new Date();
      if (to === "rejected") request.rejectedReason = ctx.reason ?? null;
      if (to === "processing" && from === "retry_required") {
        request.retryCount += 1;
        request.lastRetryAt = new Date();
      }

      const s = await manager.getRepository(PrivacyRequest).save(request);
      if (participate) await participate(manager, s);
      const eventsRepo = manager.getRepository(PrivacyEvent);
      await eventsRepo.save(eventsRepo.create({
        requestId: s.id, type: to, message: ctx.reason ?? `Status → ${to}`,
        actorEmail: ctx.actor?.email ?? null, metadata: ctx.metadata ?? null, at: new Date(),
      }));
      await this.audit.append(
        { action: `privacy.request.${to}`, actor: ctx.actor, context: ctx.requestContext, targetType: "privacy_request", targetId: s.id, beforeState: before, afterState: this.snapshot(s), metadata: ctx.reason ? { reason: ctx.reason } : null },
        manager,
      );
      return s;
    });
  }

  async assign(id: string, toEmail: string, ctx: TransitionContext = {}): Promise<PrivacyRequest> {
    return this.dataSource.transaction(async (manager) => {
      const request = await this.requireWithManager(manager, id, true);
      if (!["pending", "assigned", "in_review", "approved", "processing", "retry_required"].includes(request.status)) {
        throw new BadRequestException("This request is not in an assignable state.");
      }
      const before = this.snapshot(request);
      const now = new Date();
      const entry: AssignmentHistoryEntry = { at: now.toISOString(), fromEmail: request.assignedAdminEmail ?? null, toEmail, byEmail: ctx.actor?.email ?? null };
      if (request.assignedAdminEmail) request.reassignedAt = now;
      else request.assignedAt = now;
      request.assignedAdminEmail = toEmail;
      request.assignmentHistory = [...(request.assignmentHistory ?? []), entry];
      if (request.status === "pending") request.status = "assigned";
      const saved = await manager.getRepository(PrivacyRequest).save(request);
      const events = manager.getRepository(PrivacyEvent);
      await events.save(events.create({
        requestId: saved.id,
        type: "assigned",
        message: `Assigned to ${toEmail}`,
        actorEmail: ctx.actor?.email ?? null,
        metadata: null,
        at: now,
      }));
      await this.audit.append(
        { action: "privacy.request.assigned", actor: ctx.actor, context: ctx.requestContext, targetType: "privacy_request", targetId: saved.id, beforeState: before, afterState: this.snapshot(saved), metadata: { toEmail } },
        manager,
      );
      return saved;
    });
  }

  /** Record fulfilment evidence and move the request into "fulfilled". */
  async recordFulfilment(
    id: string,
    input: { method: string; result: string; verificationStatus: VerificationStatus; internalNotes?: string | null; timelineType?: string },
    ctx: TransitionContext = {},
  ): Promise<PrivacyRequest> {
    return this.dataSource.transaction(async (manager) => {
      const request = await this.requireWithManager(manager, id, true);
      if (request.status !== "processing") {
        throw new BadRequestException("Fulfilment can only be recorded while the request is processing.");
      }
      const before = this.snapshot(request);
      request.fulfilledByAdminEmail = ctx.actor?.email ?? null;
      request.fulfilledAt = new Date();
      request.fulfilmentMethod = input.method;
      request.fulfilmentResult = input.result;
      request.verificationStatus = input.verificationStatus;
      if (input.internalNotes) request.internalNotes = input.internalNotes;
      const verificationFailed = input.verificationStatus === "failed";
      request.status = verificationFailed ? "failed" : "fulfilled";
      request.lastError = verificationFailed ? `Fulfilment verification failed: ${input.result}` : null;
      const saved = await manager.getRepository(PrivacyRequest).save(request);
      const events = manager.getRepository(PrivacyEvent);
      await events.save(events.create({
        requestId: saved.id,
        type: input.timelineType ?? (verificationFailed ? "fulfilment.failed" : "fulfilled"),
        message: verificationFailed
          ? `Fulfilment verification failed via ${input.method} (${input.result})`
          : `Fulfilled via ${input.method} (${input.result})`,
        actorEmail: ctx.actor?.email ?? null,
        metadata: null,
        at: new Date(),
      }));
      await this.audit.append(
        { action: verificationFailed ? "privacy.request.fulfilment_failed" : "privacy.request.fulfilled", actor: ctx.actor, context: ctx.requestContext, targetType: "privacy_request", targetId: saved.id, beforeState: before, afterState: this.snapshot(saved) },
        manager,
      );
      return saved;
    });
  }

  /** Record a failure (from an executor) and move to failed. */
  async markFailed(id: string, error: string, ctx: TransitionContext = {}): Promise<PrivacyRequest> {
    return this.dataSource.transaction(async (manager) => {
      const request = await this.requireWithManager(manager, id, true);
      const before = this.snapshot(request);
      request.status = "failed";
      request.lastError = error;
      const saved = await manager.getRepository(PrivacyRequest).save(request);
      const events = manager.getRepository(PrivacyEvent);
      await events.save(events.create({
        requestId: saved.id,
        type: "failed",
        message: error,
        actorEmail: ctx.actor?.email ?? null,
        metadata: null,
        at: new Date(),
      }));
      await this.audit.append(
        { action: "privacy.request.failed", actor: ctx.actor, context: ctx.requestContext, targetType: "privacy_request", targetId: saved.id, beforeState: before, afterState: this.snapshot(saved), metadata: { error } },
        manager,
      );
      return saved;
    });
  }

  private snapshot(r: PrivacyRequest): Record<string, unknown> {
    return {
      status: r.status, type: r.type, priority: r.priority,
      assignedAdminEmail: r.assignedAdminEmail ?? null,
      fulfilledAt: r.fulfilledAt ? r.fulfilledAt.toISOString() : null,
      verificationStatus: r.verificationStatus,
      retryCount: r.retryCount,
    };
  }
}
