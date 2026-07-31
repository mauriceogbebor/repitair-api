import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { PlatformJobsService } from "./platform-jobs.service";
import { getJobDefinition, JobExecutionContext, NonRetryableJobError } from "./platform-job.types";
import type { PlatformJob } from "../../entities/platform-job.entity";

const POLL_INTERVAL_MS = 2_000;
const RECLAIM_EVERY_TICKS = 15;
const WORKER_HEARTBEAT_INTERVAL_MS = 15_000;

export type WorkerRuntimeIdentity = {
  environment?: string | null;
  revision?: string | null;
  provider?: string | null;
  storageProvider?: string | null;
};

/**
 * Durable-queue worker. Claims one job at a time (atomic SKIP LOCKED), runs the
 * registered handler under the type's timeout, and records completion/failure.
 * Runs inline when ENABLE_INLINE_WORKER=true (single-service deploys) or is
 * driven by the standalone worker bootstrap (src/worker.ts) for a separate
 * worker service. Structured logs only — never logs payloads/tokens/PII.
 */
@Injectable()
export class PlatformJobWorker implements OnModuleDestroy {
  private readonly logger = new Logger(PlatformJobWorker.name);
  private readonly workerId = `worker-${randomUUID().slice(0, 8)}`;
  private timer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private ticks = 0;
  private draining = false;
  private queues?: string[];

  constructor(
    private readonly jobs: PlatformJobsService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    if (this.config.get<string>("ENABLE_INLINE_WORKER") === "true") {
      await this.start();
    }
  }

  onModuleDestroy() {
    this.stop();
  }

  async start(queues?: string[], runtime: WorkerRuntimeIdentity = {}) {
    if (this.timer) return;
    this.queues = queues;
    const activeQueues = queues ?? [];
    await this.jobs.registerWorker({
      workerId: this.workerId,
      queues: activeQueues,
      ...runtime,
    });
    this.heartbeatTimer = setInterval(
      () => void this.jobs.heartbeatWorker(this.workerId),
      WORKER_HEARTBEAT_INTERVAL_MS,
    );
    this.logger.log(
      `[WORKER] started workerId=${this.workerId}`
      + ` environment=${runtime.environment ?? "unknown"}`
      + ` revision=${runtime.revision ?? "unknown"}`
      + ` provider=${runtime.provider ?? "unknown"}`
      + ` storage=${runtime.storageProvider ?? "unknown"}`
      + ` queues=${activeQueues.length ? activeQueues.join(",") : "all"} polling=true`,
    );
    this.timer = setInterval(() => void this.tick(), POLL_INTERVAL_MS);
  }

  /** Graceful shutdown: stop claiming new work; in-flight job finishes/releases. */
  stop() {
    this.draining = true;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    void this.jobs.markWorkerDraining(this.workerId);
  }

  private async tick() {
    if (this.draining) return;
    try {
      if (++this.ticks % RECLAIM_EVERY_TICKS === 0) {
        const n = await this.jobs.reclaimStalled();
        if (n) this.logger.warn(`Reclaimed ${n} stalled job(s)`);
      }
      const job = await this.jobs.claimNext(this.workerId, this.queues);
      if (job) await this.execute(job);
    } catch (err) {
      this.logger.error(`Worker tick error: ${(err as Error).message}`);
    }
  }

  async execute(job: PlatformJob): Promise<void> {
    const def = getJobDefinition(job.type);
    const handler = this.jobs.getHandler(job.type);
    const started = Date.now();
    const assetId = typeof job.metadata?.assetId === "string" ? job.metadata.assetId : null;
    await this.jobs.markWorkerJobClaimed(this.workerId, job);
    this.logger.log(
      `[WORKER] job claimed jobId=${job.id}`
      + ` assetId=${assetId ?? "none"}`
      + ` jobType=${job.type}`
      + ` queue=${job.queue}`
      + ` attempt=${job.attempts}/${job.maxAttempts}`
      + ` workerId=${this.workerId}`,
    );

    if (!def || !handler) {
      const failed = await this.jobs.fail(job, new NonRetryableJobError(`No handler registered for job type "${job.type}"`, "no_handler"));
      await this.jobs.markWorkerJobFailed(this.workerId, job.id, failed.lastErrorCode);
      this.logger.error(`[WORKER] job failed jobId=${job.id} jobType=${job.type} errorCode=no_handler`);
      return;
    }

    const ctx: JobExecutionContext = {
      job,
      payload: job.payload ?? {},
      reportProgress: (percent, currentStep) => this.jobs.heartbeat(job.id, percent, currentStep),
      heartbeat: () => this.jobs.heartbeat(job.id),
    };

    try {
      const result = await this.withTimeout(handler(ctx), def.timeoutMs, job.type);
      await this.jobs.complete(job, result ?? undefined);
      await this.jobs.markWorkerJobCompleted(this.workerId, job.id);
      this.logger.log(
        `[WORKER] job completed jobId=${job.id} jobType=${job.type}`
        + ` durationMs=${Date.now() - started}`,
      );
    } catch (err) {
      const saved = await this.jobs.fail(job, err);
      await this.jobs.markWorkerJobFailed(this.workerId, job.id, saved.lastErrorCode);
      this.logger.error(
        `[WORKER] job failed jobId=${job.id} jobType=${job.type}`
        + ` status=${saved.status} errorCode=${saved.lastErrorCode ?? "unknown"}`
        + ` attempt=${saved.attempts}/${saved.maxAttempts}`,
      );
    }
  }

  private withTimeout<T>(p: Promise<T>, ms: number, type: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`Job ${type} timed out after ${ms}ms`)), ms);
      p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
    });
  }
}
