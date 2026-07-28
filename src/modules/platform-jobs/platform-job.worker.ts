import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { PlatformJobsService } from "./platform-jobs.service";
import { getJobDefinition, JobExecutionContext, NonRetryableJobError } from "./platform-job.types";
import type { PlatformJob } from "../../entities/platform-job.entity";

const POLL_INTERVAL_MS = 2_000;
const RECLAIM_EVERY_TICKS = 15;

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
  private ticks = 0;
  private draining = false;
  private queues?: string[];

  constructor(
    private readonly jobs: PlatformJobsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    if (this.config.get<string>("ENABLE_INLINE_WORKER") === "true") {
      this.start();
    }
  }

  onModuleDestroy() {
    this.stop();
  }

  start(queues?: string[]) {
    if (this.timer) return;
    this.queues = queues;
    this.logger.log(`Platform job worker ${this.workerId} started${queues ? ` (queues: ${queues.join(",")})` : ""}`);
    this.timer = setInterval(() => void this.tick(), POLL_INTERVAL_MS);
  }

  /** Graceful shutdown: stop claiming new work; in-flight job finishes/releases. */
  stop() {
    this.draining = true;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
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
    this.logger.log(`job.started id=${job.id} type=${job.type} queue=${job.queue} attempt=${job.attempts}/${job.maxAttempts} worker=${this.workerId}`);

    if (!def || !handler) {
      await this.jobs.fail(job, new NonRetryableJobError(`No handler registered for job type "${job.type}"`, "no_handler"));
      this.logger.error(`job.failed id=${job.id} type=${job.type} code=no_handler`);
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
      this.logger.log(`job.completed id=${job.id} type=${job.type} durationMs=${Date.now() - started}`);
    } catch (err) {
      const saved = await this.jobs.fail(job, err);
      this.logger.error(`job.${saved.status} id=${job.id} type=${job.type} code=${saved.lastErrorCode} attempt=${saved.attempts}/${saved.maxAttempts}`);
    }
  }

  private withTimeout<T>(p: Promise<T>, ms: number, type: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`Job ${type} timed out after ${ms}ms`)), ms);
      p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
    });
  }
}
