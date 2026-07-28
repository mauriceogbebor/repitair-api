import { Injectable, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { PrivacyRequest } from "../../entities/privacy-request.entity";
import { PlatformJobsService } from "../platform-jobs/platform-jobs.service";
import { NonRetryableJobError } from "../platform-jobs/platform-job.types";
import { PrivacyExecutionService } from "./privacy-execution.service";

/**
 * Registers the privacy domain's job handlers with the shared Platform Job
 * System. The handlers ONLY call the existing domain executors — no export or
 * deletion business logic is duplicated here. The executor records fulfilment
 * through PrivacyWorkflowService, so the domain remains the source of truth.
 *
 * On executor failure the handler throws NonRetryableJobError so the platform
 * job fails visibly (consistent with the privacy request, which the executor
 * already marked failed). Recovery is operator-driven via the privacy Retry
 * action, which re-transitions the request and re-enqueues the job — never
 * silent, never divergent.
 */
@Injectable()
export class PrivacyJobHandlers implements OnModuleInit {
  constructor(
    private readonly platformJobs: PlatformJobsService,
    private readonly execution: PrivacyExecutionService,
    @InjectRepository(PrivacyRequest) private readonly requests: Repository<PrivacyRequest>,
  ) {}

  onModuleInit() {
    this.platformJobs.registerHandler("privacy.data_export", async (ctx) => {
      const request = await this.load(String(ctx.payload.privacyRequestId));
      await ctx.reportProgress(20, "generating export");
      const job = await this.execution.runExport(request);
      if (job.status !== "succeeded") {
        throw new NonRetryableJobError(`Export did not succeed: ${job.lastError ?? "unknown error"}`, "export_incomplete");
      }
      return { privacyJobId: job.id };
    });

    this.platformJobs.registerHandler("privacy.account_deletion", async (ctx) => {
      const request = await this.load(String(ctx.payload.privacyRequestId));
      await ctx.reportProgress(10, "executing deletion");
      const job = await this.execution.runDeletion(request);
      if (job.status !== "succeeded") {
        throw new NonRetryableJobError(`Deletion did not complete: ${job.lastError ?? "partial"}`, "deletion_incomplete");
      }
      return { privacyJobId: job.id };
    });
  }

  /**
   * Loads the request AND validates it is in 'processing' before any execution.
   * A stale or duplicate job (request already cancelled/completed/failed) is
   * refused non-retryably, so destructive work never runs against the wrong state.
   */
  private async load(id: string): Promise<PrivacyRequest> {
    const request = await this.requests.findOne({ where: { id } });
    if (!request) throw new NonRetryableJobError("Privacy request not found", "missing_record");
    if (request.status !== "processing") {
      throw new NonRetryableJobError(`Request is not processing (status: ${request.status}) — stale or duplicate job`, "stale_job");
    }
    return request;
  }
}
