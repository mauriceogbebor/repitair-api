import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { PrivacyRequest, PrivacyRequestStatus, PrivacyRequestType } from "../../entities/privacy-request.entity";
import { PrivacyJob } from "../../entities/privacy-job.entity";
import { PrivacyWorkflowService } from "./privacy-workflow.service";
import { PrivacyExecutionService } from "./privacy-execution.service";

export interface PrivacyListFilters {
  status?: PrivacyRequestStatus;
  type?: PrivacyRequestType;
  assignedAdminEmail?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  sortBy?: "createdAt" | "dueAt" | "priority" | "status";
  sortOrder?: "ASC" | "DESC";
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

@Injectable()
export class PrivacyQueryService {
  constructor(
    @InjectRepository(PrivacyRequest) private readonly requests: Repository<PrivacyRequest>,
    @InjectRepository(PrivacyJob) private readonly jobs: Repository<PrivacyJob>,
    private readonly workflow: PrivacyWorkflowService,
    private readonly execution: PrivacyExecutionService,
  ) {}

  serialize(request: PrivacyRequest) {
    return { ...request, sla: PrivacyWorkflowService.slaView(request) };
  }

  async list(filters: PrivacyListFilters) {
    const page = Math.max(filters.page ?? 1, 1);
    const pageSize = Math.min(filters.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const qb = this.requests.createQueryBuilder("r");
    if (filters.status) qb.andWhere("r.status = :status", { status: filters.status });
    if (filters.type) qb.andWhere("r.type = :type", { type: filters.type });
    if (filters.assignedAdminEmail) qb.andWhere("r.assignedAdminEmail = :ae", { ae: filters.assignedAdminEmail });
    if (filters.search) qb.andWhere("(r.userEmail ILIKE :s OR r.userId::text ILIKE :s)", { s: `%${filters.search}%` });
    const total = await qb.getCount();
    const sortBy = filters.sortBy ?? "createdAt";
    qb.orderBy(`r.${sortBy}`, filters.sortOrder ?? "DESC").offset((page - 1) * pageSize).limit(pageSize);
    const rows = await qb.getMany();
    return { total, page, pageSize, records: rows.map((r) => this.serialize(r)) };
  }

  /** Owner-scoped reads for the consumer intake API. */
  async listForUser(userId: string) {
    const records = await this.requests.find({ where: { userId }, order: { createdAt: "DESC" }, take: 100 });
    return { total: records.length, records: records.map((r) => this.serialize(r)) };
  }

  async getForUser(userId: string, id: string) {
    const request = await this.requests.findOne({ where: { id, userId } });
    if (!request) throw new NotFoundException("Privacy request not found");
    const timeline = await this.workflow.getTimeline(id);
    return { request: this.serialize(request), timeline };
  }

  async detail(id: string) {
    const request = await this.requests.findOne({ where: { id } });
    if (!request) throw new NotFoundException("Privacy request not found");
    const [jobs, timeline] = await Promise.all([this.execution.getJobs(id), this.workflow.getTimeline(id)]);
    return { request: this.serialize(request), jobs: jobs.map((j) => this.redactJob(j)), timeline };
  }

  /**
   * Safe job projection for request detail. NEVER returns the export package,
   * the download-token hash, or raw step details (which could contain URLs) —
   * only status, timings, attempts, failure state, and a safe summary.
   */
  private redactJob(job: PrivacyJob) {
    const r = (job.result ?? null) as Record<string, unknown> | null;
    return {
      id: job.id,
      type: job.type,
      status: job.status,
      attempts: job.attempts,
      startedAt: job.startedAt ?? null,
      finishedAt: job.finishedAt ?? null,
      durationMs: job.durationMs ?? null,
      lastError: job.lastError ?? null,
      createdAt: job.createdAt,
      summary: r
        ? {
            outcome: r.outcome ?? null,
            packageSummary: r.packageSummary ?? null,
            deletedRecords: r.deletedRecords ?? null,
            deletedFiles: r.deletedFiles ?? null,
            expiresAt: job.downloadExpiresAt ?? null,
            downloadedAt: job.downloadedAt ?? null,
            failureReason: r.failureReason ?? null,
          }
        : null,
    };
  }

  /**
   * Overview cards + dashboard metrics (WS13). Computed with DATABASE
   * aggregations — never by loading every request/job into memory.
   */
  async overview() {
    const ACTIVE = ["pending", "assigned", "in_review", "approved", "processing", "fulfilled", "retry_required"];

    const statusRows = await this.requests.createQueryBuilder("r")
      .select("r.status", "status").addSelect("COUNT(*)", "count").groupBy("r.status").getRawMany<{ status: string; count: string }>();
    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const row of statusRows) { const n = Number(row.count); byStatus[row.status] = n; total += n; }

    const typeRows = await this.requests.createQueryBuilder("r")
      .select("r.type", "type").addSelect("COUNT(*)", "count").groupBy("r.type").getRawMany<{ type: string; count: string }>();
    const requestsByType: Record<string, number> = {};
    for (const row of typeRows) requestsByType[row.type] = Number(row.count);

    const overdue = await this.requests.createQueryBuilder("r")
      .where("r.status IN (:...active)", { active: ACTIVE }).andWhere("r.dueAt IS NOT NULL AND r.dueAt < now()").getCount();

    const avgRow = await this.requests.createQueryBuilder("r")
      .select("AVG(EXTRACT(EPOCH FROM (r.completedAt - r.createdAt)) * 1000)", "ms")
      .where("r.status = 'completed' AND r.completedAt IS NOT NULL").getRawOne<{ ms: string | null }>();
    const averageResolutionMs = avgRow?.ms != null ? Math.round(Number(avgRow.ms)) : null;

    const jobStatusRows = await this.jobs.createQueryBuilder("j")
      .select("j.type", "type").addSelect("j.status", "status").addSelect("COUNT(*)", "count")
      .where("j.type IN ('account_deletion', 'data_export')").groupBy("j.type").addGroupBy("j.status")
      .getRawMany<{ type: string; status: string; count: string }>();
    let exportsGenerated = 0, deletionDone = 0, deletionAttempted = 0;
    for (const row of jobStatusRows) {
      const n = Number(row.count);
      if (row.type === "data_export" && row.status === "succeeded") exportsGenerated += n;
      if (row.type === "account_deletion") { deletionAttempted += n; if (row.status === "succeeded") deletionDone += n; }
    }

    return {
      cards: {
        pending: byStatus.pending ?? 0,
        assigned: byStatus.assigned ?? 0,
        processing: byStatus.processing ?? 0,
        completed: byStatus.completed ?? 0,
        failed: (byStatus.failed ?? 0) + (byStatus.retry_required ?? 0),
        overdue,
      },
      averageResolutionMs,
      exportsGenerated,
      deletionSuccessRate: deletionAttempted ? Number(((deletionDone / deletionAttempted) * 100).toFixed(1)) : null,
      requestsByType,
      total,
    };
  }
}
