import { BadRequestException, ForbiddenException, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, EntityManager, Repository } from "typeorm";
import { PlatformJob, PlatformJobPriority, PlatformJobStatus } from "../../entities/platform-job.entity";
import {
  PlatformWorkerHeartbeat,
  PlatformWorkerState,
} from "../../entities/platform-worker-heartbeat.entity";
import { PlatformService } from "../platform/platform.service";
import {
  classifyError,
  computeBackoffMs,
  getJobDefinition,
  JobDefinition,
  PlatformJobHandler,
} from "./platform-job.types";

export interface EnqueueInput {
  type: string;
  payload?: Record<string, unknown>;
  priority?: PlatformJobPriority;
  idempotencyKey?: string;
  correlationId?: string;
  parentJobId?: string;
  createdBy?: string;
  scheduledFor?: Date;
  metadata?: Record<string, unknown>;
}

const ACTIVE_OR_DONE: PlatformJobStatus[] = ["created", "queued", "scheduled", "running", "retry_scheduled", "completed"];
const CANCELLABLE_BEFORE_RUN: PlatformJobStatus[] = ["created", "queued", "scheduled", "retry_scheduled", "paused"];
const WORKER_STALE_AFTER_MS = 45_000;

type WorkerRegistration = {
  workerId: string;
  queues: string[];
  environment?: string | null;
  revision?: string | null;
  provider?: string | null;
  storageProvider?: string | null;
};

/**
 * The single shared execution layer. Domain modules interact only through this
 * service (enqueue + registerHandler + callbacks); they never touch queue
 * internals. Durable Postgres-backed queue with atomic claiming — survives
 * restarts, no in-memory execution.
 */
@Injectable()
export class PlatformJobsService {
  private readonly logger = new Logger(PlatformJobsService.name);
  private readonly handlers = new Map<string, PlatformJobHandler>();

  constructor(
    @InjectRepository(PlatformJob) private readonly jobs: Repository<PlatformJob>,
    @InjectRepository(PlatformWorkerHeartbeat)
    private readonly workerHeartbeats: Repository<PlatformWorkerHeartbeat>,
    private readonly dataSource: DataSource,
    private readonly platform: PlatformService,
  ) {}

  registerHandler(type: string, handler: PlatformJobHandler): void {
    if (!getJobDefinition(type)) {
      this.logger.warn(`Handler registered for unknown job type "${type}" — ignored`);
      return;
    }
    this.handlers.set(type, handler);
  }

  getHandler(type: string): PlatformJobHandler | undefined {
    return this.handlers.get(type);
  }

  // ── Enqueue (idempotent, validated) ──────────────────────────────────────
  async enqueue(input: EnqueueInput): Promise<PlatformJob> {
    return this.enqueueUsingRepository(this.jobs, input);
  }

  /**
   * Enqueue inside a caller-owned transaction. This is the durable handoff
   * used when a domain state change and its background work must commit as one
   * unit, eliminating the "state changed but no job exists" crash window.
   */
  async enqueueWithManager(manager: EntityManager, input: EnqueueInput): Promise<PlatformJob> {
    return this.enqueueUsingRepository(manager.getRepository(PlatformJob), input);
  }

  private async enqueueUsingRepository(
    repository: Repository<PlatformJob>,
    input: EnqueueInput,
  ): Promise<PlatformJob> {
    const def = getJobDefinition(input.type);
    if (!def) throw new BadRequestException(`Unknown job type "${input.type}"`);

    const payload = input.payload ?? {};
    const validationError = def.validate?.(payload);
    if (validationError) throw new BadRequestException(`Invalid payload for ${input.type}: ${validationError}`);

    if (def.requiredFlag && !(await this.platform.isEnabled(def.requiredFlag))) {
      throw new ForbiddenException(`Feature "${def.requiredFlag}" is disabled — ${input.type} cannot be enqueued.`);
    }

    if (input.idempotencyKey) {
      const existing = await repository.findOne({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) {
        // Active or completed → return as-is (never duplicate work).
        if (ACTIVE_OR_DONE.includes(existing.status)) return existing;
        // Terminal-failed → re-arm the SAME row (the unique idempotency key
        // forbids a second row) so a fresh run is scheduled with one more attempt.
        existing.status = "queued";
        existing.queuedAt = new Date();
        existing.nextRetryAt = null;
        existing.failedAt = null;
        existing.maxAttempts = Math.max(existing.maxAttempts, existing.attempts + 1);
        return repository.save(existing);
      }
    }

    const scheduled = input.scheduledFor && input.scheduledFor.getTime() > Date.now();
    const job = repository.create({
      queue: def.queue,
      type: input.type,
      domain: def.domain,
      payload,
      payloadVersion: def.payloadVersion,
      status: scheduled ? "scheduled" : "queued",
      priority: input.priority ?? "normal",
      idempotencyKey: input.idempotencyKey ?? null,
      correlationId: input.correlationId ?? null,
      parentJobId: input.parentJobId ?? null,
      createdBy: input.createdBy ?? null,
      scheduledFor: input.scheduledFor ?? null,
      queuedAt: scheduled ? null : new Date(),
      attempts: 0,
      maxAttempts: def.maxAttempts,
      metadata: input.metadata ?? null,
    });
    return repository.save(job);
  }

  // ── Atomic claim (FOR UPDATE SKIP LOCKED) ────────────────────────────────
  async claimNext(workerId: string, queues?: string[]): Promise<PlatformJob | null> {
    return this.dataSource.transaction(async (manager) => {
      const params: unknown[] = [];
      let queueClause = "";
      if (queues && queues.length) {
        queueClause = `AND "queue" = ANY($1)`;
        params.push(queues);
      }
      const rows: Array<{ id: string }> = await manager.query(
        `SELECT "id" FROM "platform_jobs"
         WHERE ("status" = 'queued'
             OR ("status" = 'scheduled' AND "scheduledFor" <= now())
             OR ("status" = 'retry_scheduled' AND "nextRetryAt" <= now()))
           ${queueClause}
         ORDER BY CASE "priority" WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
                  "createdAt" ASC
         LIMIT 1 FOR UPDATE SKIP LOCKED`,
        params,
      );
      if (!rows.length) return null;
      const repo = manager.getRepository(PlatformJob);
      const job = await repo.findOne({ where: { id: rows[0].id } });
      if (!job) return null;
      const now = new Date();
      job.status = "running";
      job.workerId = workerId;
      job.lockedAt = now;
      job.heartbeatAt = now;
      if (!job.startedAt) job.startedAt = now;
      job.attempts += 1;
      return repo.save(job);
    });
  }

  async heartbeat(id: string, progress?: number, currentStep?: string): Promise<void> {
    const patch: { heartbeatAt: Date; progress?: number } = { heartbeatAt: new Date() };
    if (typeof progress === "number") patch.progress = Math.max(0, Math.min(100, Math.round(progress)));
    await this.jobs.update({ id }, patch);
    if (currentStep) {
      // currentStep lives in metadata jsonb; update it via the entity to satisfy typing.
      const job = await this.jobs.findOne({ where: { id } });
      if (job) { job.metadata = { ...(job.metadata ?? {}), currentStep }; await this.jobs.save(job); }
    }
  }

  async complete(job: PlatformJob, result?: Record<string, unknown>): Promise<PlatformJob> {
    job.status = "completed";
    job.completedAt = new Date();
    job.durationMs = job.startedAt ? job.completedAt.getTime() - job.startedAt.getTime() : null;
    job.result = result ?? job.result ?? null;
    job.progress = 100;
    job.workerId = null;
    job.lockedAt = null;
    return this.jobs.save(job);
  }

  async fail(job: PlatformJob, err: unknown): Promise<PlatformJob> {
    const def = getJobDefinition(job.type);
    const { code, retryable } = classifyError(err);
    job.lastErrorCode = code;
    job.lastErrorMessage = err instanceof Error ? err.message : String(err);
    job.lastErrorStack = err instanceof Error ? (err.stack ?? null) : null;
    job.workerId = null;
    job.lockedAt = null;

    const exhausted = job.attempts >= job.maxAttempts;
    if (retryable && !exhausted && def) {
      job.status = "retry_scheduled";
      job.nextRetryAt = new Date(Date.now() + computeBackoffMs(job.attempts, def));
    } else if (retryable && exhausted) {
      job.status = "dead_lettered";
      job.failedAt = new Date();
    } else {
      job.status = "failed"; // non-retryable
      job.failedAt = new Date();
    }
    return this.jobs.save(job);
  }

  // ── Admin operational controls ───────────────────────────────────────────
  async retry(id: string, actor?: string | null): Promise<PlatformJob> {
    const job = await this.requireJob(id);
    if (!["failed", "dead_lettered"].includes(job.status)) {
      throw new BadRequestException(`Only failed or dead-lettered jobs can be retried (status: ${job.status}).`);
    }
    job.status = "queued";
    job.queuedAt = new Date();
    job.nextRetryAt = null;
    job.failedAt = null;
    if (job.attempts >= job.maxAttempts) job.maxAttempts = job.attempts + 1; // grant one more attempt
    job.metadata = { ...(job.metadata ?? {}), retriedBy: actor ?? null, retriedAt: new Date().toISOString() };
    return this.jobs.save(job);
  }

  async cancel(id: string, actor?: string | null, reason?: string | null): Promise<PlatformJob> {
    const job = await this.requireJob(id);
    const def = getJobDefinition(job.type);
    const safeBeforeRun = CANCELLABLE_BEFORE_RUN.includes(job.status);
    if (!safeBeforeRun) {
      throw new BadRequestException(`Cannot cancel a ${job.status} job (destructive work may be in progress).`);
    }
    if (def && !def.cancellable) {
      throw new BadRequestException(`Job type "${job.type}" does not support cancellation.`);
    }
    const previous = job.status;
    job.status = "cancelled";
    job.cancelledAt = new Date();
    job.metadata = { ...(job.metadata ?? {}), cancelledBy: actor ?? null, cancelReason: reason ?? null, previousStatus: previous };
    return this.jobs.save(job);
  }

  async requireJob(id: string): Promise<PlatformJob> {
    const job = await this.jobs.findOne({ where: { id } });
    if (!job) throw new BadRequestException("Job not found");
    return job;
  }

  // ── Durable worker presence and operational health ──────────────────────
  async registerWorker(input: WorkerRegistration): Promise<void> {
    const now = new Date();
    const existing = await this.workerHeartbeats.findOne({ where: { id: input.workerId } });
    await this.workerHeartbeats.save(this.workerHeartbeats.create({
      ...(existing ?? {}),
      id: input.workerId,
      state: "running",
      queues: input.queues,
      environment: input.environment ?? null,
      revision: input.revision ?? null,
      provider: input.provider ?? null,
      storageProvider: input.storageProvider ?? null,
      currentJobId: null,
      startedAt: now,
      heartbeatAt: now,
    }));
  }

  async heartbeatWorker(workerId: string): Promise<void> {
    await this.workerHeartbeats.update({ id: workerId }, {
      state: "running",
      heartbeatAt: new Date(),
    });
  }

  async markWorkerJobClaimed(workerId: string, job: PlatformJob): Promise<void> {
    const now = new Date();
    await this.workerHeartbeats.update({ id: workerId }, {
      state: "running",
      currentJobId: job.id,
      lastClaimedJobId: job.id,
      lastClaimedAt: now,
      heartbeatAt: now,
    });
  }

  async markWorkerJobCompleted(workerId: string, jobId: string): Promise<void> {
    const now = new Date();
    await this.workerHeartbeats.update({ id: workerId }, {
      currentJobId: null,
      lastCompletedJobId: jobId,
      lastCompletedAt: now,
      heartbeatAt: now,
    });
  }

  async markWorkerJobFailed(workerId: string, jobId: string, errorCode?: string | null): Promise<void> {
    const now = new Date();
    await this.workerHeartbeats.update({ id: workerId }, {
      currentJobId: null,
      lastFailedJobId: jobId,
      lastFailedAt: now,
      lastErrorCode: errorCode ?? null,
      heartbeatAt: now,
    });
  }

  async markWorkerDraining(workerId: string): Promise<void> {
    await this.workerHeartbeats.update({ id: workerId }, {
      state: "draining" as PlatformWorkerState,
      heartbeatAt: new Date(),
    });
  }

  async workerHealth() {
    const now = Date.now();
    const workers = await this.workerHeartbeats.find({ order: { heartbeatAt: "DESC" } });
    const activeWorkers = workers.filter((worker) => (
      worker.state === "running"
      && now - new Date(worker.heartbeatAt).getTime() <= WORKER_STALE_AFTER_MS
    ));
    const queuedCount = await this.jobs.count({ where: { status: "queued" } });
    const runningCount = await this.jobs.count({ where: { status: "running" } });
    const oldestQueued = await this.jobs.findOne({
      where: { status: "queued" },
      order: { queuedAt: "ASC", createdAt: "ASC" },
    });
    const oldestQueueAgeMs = oldestQueued
      ? Math.max(0, now - new Date(oldestQueued.queuedAt ?? oldestQueued.createdAt).getTime())
      : null;

    return {
      status: activeWorkers.length > 0
        ? "healthy"
        : queuedCount > 0
          ? "critical"
          : "warning",
      activeWorkerCount: activeWorkers.length,
      queuedCount,
      runningCount,
      oldestQueueAgeMs,
      staleAfterMs: WORKER_STALE_AFTER_MS,
      workers: workers.map((worker) => ({
        id: worker.id,
        state: worker.state,
        alive: activeWorkers.some((active) => active.id === worker.id),
        queues: worker.queues,
        environment: worker.environment ?? null,
        revision: worker.revision ?? null,
        provider: worker.provider ?? null,
        storageProvider: worker.storageProvider ?? null,
        currentJobId: worker.currentJobId ?? null,
        lastClaimedJobId: worker.lastClaimedJobId ?? null,
        lastClaimedAt: worker.lastClaimedAt ?? null,
        lastCompletedJobId: worker.lastCompletedJobId ?? null,
        lastCompletedAt: worker.lastCompletedAt ?? null,
        lastFailedJobId: worker.lastFailedJobId ?? null,
        lastFailedAt: worker.lastFailedAt ?? null,
        lastErrorCode: worker.lastErrorCode ?? null,
        startedAt: worker.startedAt,
        heartbeatAt: worker.heartbeatAt,
      })),
    };
  }

  // ── Reads for the admin Jobs module ──────────────────────────────────────
  async list(
    filters: { queue?: string; type?: string; domain?: string; status?: PlatformJobStatus; search?: string; page?: number; pageSize?: number },
    view: { payload?: boolean; errors?: boolean } = {},
  ) {
    const page = Math.max(filters.page ?? 1, 1);
    const pageSize = Math.min(filters.pageSize ?? 25, 100);
    const qb = this.jobs.createQueryBuilder("j");
    if (filters.queue) qb.andWhere("j.queue = :q", { q: filters.queue });
    if (filters.type) qb.andWhere("j.type = :t", { t: filters.type });
    if (filters.domain) qb.andWhere("j.domain = :d", { d: filters.domain });
    if (filters.status) qb.andWhere("j.status = :s", { s: filters.status });
    if (filters.search) qb.andWhere("(j.id::text = :sv OR j.correlationId = :sv OR j.idempotencyKey ILIKE :like)", { sv: filters.search, like: `%${filters.search}%` });
    const total = await qb.getCount();
    qb.orderBy("j.createdAt", "DESC").offset((page - 1) * pageSize).limit(pageSize);
    const rows = await qb.getMany();
    return { total, page, pageSize, records: rows.map((j) => this.redact(j, view)) };
  }

  async detail(id: string, view: { payload?: boolean; errors?: boolean } = {}) {
    return this.redact(await this.requireJob(id), view);
  }

  /** Latest media job for operational correlation without exposing payload values. */
  async findLatestForMediaAsset(assetId: string): Promise<PlatformJob | null> {
    return this.jobs.createQueryBuilder("j")
      .where("j.type = :type", { type: "media.background_remove" })
      .andWhere("j.metadata ->> 'assetId' = :assetId", { assetId })
      .orderBy("j.createdAt", "DESC")
      .getOne();
  }

  async attachMediaCorrelation(
    assetId: string,
    correlation: { templateId: string; repitId: string },
  ): Promise<PlatformJob | null> {
    const job = await this.findLatestForMediaAsset(assetId);
    if (!job) return null;
    job.metadata = { ...(job.metadata ?? {}), ...correlation };
    job.correlationId = `template:${correlation.templateId}:repit:${correlation.repitId}:asset:${assetId}`;
    return this.jobs.save(job);
  }

  async overview() {
    const rows = await this.jobs.find();
    const byStatus = (s: PlatformJobStatus) => rows.filter((r) => r.status === s).length;
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const completedToday = rows.filter((r) => r.status === "completed" && r.completedAt && new Date(r.completedAt) >= startOfDay);
    const durations = rows.filter((r) => r.durationMs != null).map((r) => r.durationMs as number);
    return {
      cards: {
        queued: byStatus("queued"),
        scheduled: byStatus("scheduled"),
        running: byStatus("running"),
        retrying: byStatus("retry_scheduled"),
        failed: byStatus("failed"),
        deadLettered: byStatus("dead_lettered"),
        completedToday: completedToday.length,
      },
      averageDurationMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
      total: rows.length,
    };
  }

  /**
   * Recover jobs whose worker died mid-execution: running jobs whose heartbeat
   * is older than their type timeout (×2 grace). Re-queued for retry (respecting
   * idempotency) or dead-lettered when attempts are exhausted. Never duplicates
   * destructive work — the handler's idempotency guards protect re-execution.
   */
  async reclaimStalled(): Promise<number> {
    const running = await this.jobs.find({ where: { status: "running" } });
    const now = Date.now();
    let reclaimed = 0;
    for (const job of running) {
      const def = getJobDefinition(job.type);
      const grace = (def?.timeoutMs ?? 120_000) * 2;
      const hb = job.heartbeatAt ? new Date(job.heartbeatAt).getTime() : new Date(job.startedAt ?? job.createdAt).getTime();
      if (now - hb <= grace) continue;
      await this.fail(job, new Error("Worker stalled: heartbeat timeout"));
      reclaimed++;
    }
    return reclaimed;
  }

  /**
   * Redact a job for the admin surface. Payload VALUES are never returned.
   * Least-privilege view scopes:
   *   - base `jobs.view`: lifecycle, timing, attempts, operational identifiers.
   *   - `jobs.view_payload` (opts.payload): payload KEYS, metadata, derived
   *     related-resource id.
   *   - `jobs.view_errors` (opts.errors): error code + message.
   */
  private redact(job: PlatformJob, opts: { payload?: boolean; errors?: boolean } = {}) {
    const showPayload = opts.payload === true;
    const showErrors = opts.errors === true;
    const payloadKeys = showPayload && job.payload ? Object.keys(job.payload) : [];
    const result = job.result ? { outcome: (job.result as Record<string, unknown>).outcome ?? null, summary: (job.result as Record<string, unknown>).packageSummary ?? (job.result as Record<string, unknown>).steps ? "[recorded]" : null } : null;
    return {
      id: job.id, queue: job.queue, type: job.type, domain: job.domain, status: job.status, priority: job.priority,
      attempts: job.attempts, maxAttempts: job.maxAttempts, progress: job.progress ?? null,
      correlationId: job.correlationId ?? null, idempotencyKey: job.idempotencyKey ?? null,
      createdBy: job.createdBy ?? null, workerId: job.workerId ?? null,
      scheduledFor: job.scheduledFor ?? null, queuedAt: job.queuedAt ?? null, startedAt: job.startedAt ?? null,
      completedAt: job.completedAt ?? null, failedAt: job.failedAt ?? null, cancelledAt: job.cancelledAt ?? null,
      nextRetryAt: job.nextRetryAt ?? null, heartbeatAt: job.heartbeatAt ?? null, durationMs: job.durationMs ?? null,
      lastErrorCode: showErrors ? job.lastErrorCode ?? null : null,
      lastErrorMessage: showErrors ? job.lastErrorMessage ?? null : null,
      payloadKeys, // keys only, and only with jobs.view_payload — values are never returned
      result,
      relatedResource: showPayload && job.payload ? (job.payload.privacyRequestId ?? job.payload.notificationId ?? job.payload.spotlightId ?? null) : null,
      createdAt: job.createdAt, updatedAt: job.updatedAt,
      metadata: showPayload ? job.metadata ?? null : null,
    };
  }
}
