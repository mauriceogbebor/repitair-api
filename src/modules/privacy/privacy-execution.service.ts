import { Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { createHash, randomBytes } from "node:crypto";
import { DataSource, Repository } from "typeorm";
import { MailService } from "../../common/services/mail.service";
import { PrivacyRequest } from "../../entities/privacy-request.entity";
import { PrivacyJob, PrivacyJobType } from "../../entities/privacy-job.entity";
import { User } from "../../entities/user.entity";
import { Repit } from "../../entities/repit.entity";
import { PushToken } from "../../entities/push-token.entity";
import { ContactSubmission } from "../../entities/contact-submission.entity";
import { AdminAuditLog } from "../../entities/admin-audit-log.entity";
import { UploadsService } from "../uploads/uploads.service";
import { PrivacyWorkflowService, TransitionContext } from "./privacy-workflow.service";

interface StepResult {
  name: string;
  status: "succeeded" | "failed" | "skipped";
  detail?: string;
}

const EXPORT_TTL_MS = 24 * 3600 * 1000;

@Injectable()
export class PrivacyExecutionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrivacyExecutionService.name);
  private exportCleanupTimer?: NodeJS.Timeout;

  constructor(
    @InjectRepository(PrivacyJob) private readonly jobs: Repository<PrivacyJob>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Repit) private readonly repits: Repository<Repit>,
    @InjectRepository(PushToken) private readonly pushTokens: Repository<PushToken>,
    @InjectRepository(ContactSubmission) private readonly support: Repository<ContactSubmission>,
    @InjectRepository(AdminAuditLog) private readonly auditLogs: Repository<AdminAuditLog>,
    private readonly uploads: UploadsService,
    private readonly workflow: PrivacyWorkflowService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    if (process.env.REPITAIR_PROCESS_ROLE === "worker") return;
    void this.purgeExpiredExportPackages();
    this.exportCleanupTimer = setInterval(
      () => void this.purgeExpiredExportPackages(),
      60 * 60 * 1000,
    );
    this.exportCleanupTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.exportCleanupTimer) clearInterval(this.exportCleanupTimer);
  }

  private async purgeExpiredExportPackages(): Promise<void> {
    try {
      const result = await this.jobs.createQueryBuilder()
        .update(PrivacyJob)
        .set({
          downloadTokenHash: null,
          result: () => `"result" - 'package'`,
        })
        .where(`"type" = :type`, { type: "data_export" })
        .andWhere(`"downloadExpiresAt" IS NOT NULL`)
        .andWhere(`"downloadExpiresAt" <= now()`)
        .andWhere(`"result" ? 'package'`)
        .execute();
      if ((result.affected ?? 0) > 0) {
        this.logger.log(`Purged ${result.affected} expired privacy export package(s)`);
      }
    } catch (error) {
      this.logger.error(`Failed to purge expired privacy exports: ${(error as Error).message}`);
    }
  }

  getJobs(requestId: string): Promise<PrivacyJob[]> {
    return this.jobs.find({ where: { requestId }, order: { createdAt: "ASC" } });
  }

  private async newJob(requestId: string, type: PrivacyJobType): Promise<PrivacyJob> {
    return this.jobs.save(this.jobs.create({ requestId, type, status: "running", attempts: 1, startedAt: new Date() }));
  }

  private extractKey(url: string): string | null {
    try {
      return new URL(url).pathname.replace(/^\/+/, "");
    } catch {
      return null;
    }
  }

  /** Distinguishes a real deletion failure from a skip so cleanup can be honest. */
  private async tryDeleteUrl(url?: string | null): Promise<"deleted" | "skipped" | "failed"> {
    if (!url) return "skipped";
    const key = this.extractKey(url);
    if (!key) return "skipped";
    try {
      await this.uploads.deleteFile(key);
      return "deleted";
    } catch {
      return "failed"; // a genuine storage failure must NOT be reported as success
    }
  }

  // ── Pre-deletion analysis (WS4) ──────────────────────────────────────────
  async analyzeUser(userId: string, userEmail?: string | null) {
    const [repits, drafts, pushTokens] = await Promise.all([
      this.repits.count({ where: { userId } }),
      this.repits.count({ where: { userId, status: "draft" } }),
      this.pushTokens.count({ where: { userId } }),
    ]);
    const userRepits = await this.repits.find({ where: { userId }, select: ["id", "templateId", "backgroundPhotoUrl"] as (keyof Repit)[] });
    const templatesUsed = new Set(userRepits.map((r) => r.templateId).filter(Boolean)).size;
    const uploadedPhotos = userRepits.filter((r) => r.backgroundPhotoUrl).length;
    const supportCases = userEmail ? await this.support.count({ where: { email: userEmail } }) : 0;
    return {
      repits, drafts, templatesUsed,
      spotlightParticipation: 0, // no per-user spotlight participation model in Release 1
      supportCases, uploadedPhotos,
      profileImages: 0, // resolved during execution from the user row
      pushTokens, sessions: 1, // consumer sessions are stateless JWT; invalidated via sessionVersion
      storageBytes: null as number | null, // not tracked per-object in Release 1
    };
  }

  // ── Deletion executor (WS4): stepwise, stop-on-failure ───────────────────
  async runDeletion(request: PrivacyRequest, ctx: TransitionContext = {}): Promise<PrivacyJob> {
    const job = await this.newJob(request.id, "account_deletion");
    const steps: StepResult[] = [];
    const started = Date.now();
    let deletedRecords = 0;
    let deletedFiles = 0;

    const fail = async (name: string, error: string) => {
      steps.push({ name, status: "failed", detail: error });
      job.status = "retry_required";
      job.finishedAt = new Date();
      job.durationMs = Date.now() - started;
      job.lastError = error;
      job.result = { outcome: "partial", steps, failureReason: error, deletedRecords, deletedFiles };
      await this.jobs.save(job);
      await this.workflow.markFailed(request.id, `Deletion step "${name}" failed: ${error}`, ctx);
      return job;
    };

    try {
      const user = await this.users.findOne({ where: { id: request.userId }, relations: ["repits"] });
      if (!user) return await fail("load_user", "User no longer exists");

      // 1. push tokens
      try {
        const r = await this.pushTokens.delete({ userId: user.id });
        deletedRecords += r.affected ?? 0;
        steps.push({ name: "delete_push_tokens", status: "succeeded", detail: `${r.affected ?? 0} removed` });
      } catch (e) { return await fail("delete_push_tokens", (e as Error).message); }

      // 2. storage cleanup — track attempted/deleted/missing/failed separately.
      // If ANY file fails we STOP before deleting the user (retry-safe: the user
      // still exists), and we do NOT report cleanup as successful/verified.
      let attemptedFiles = 0, missingFiles = 0, failedFiles = 0;
      const urls = [...(user.repits ?? []).map((r) => r.backgroundPhotoUrl), user.avatarUrl];
      for (const url of urls) {
        if (!url) continue;
        attemptedFiles++;
        const outcome = await this.tryDeleteUrl(url);
        if (outcome === "deleted") deletedFiles++;
        else if (outcome === "skipped") missingFiles++;
        else failedFiles++;
      }
      if (failedFiles > 0) {
        return await fail("cleanup_storage", `${failedFiles} of ${attemptedFiles} files failed to delete`);
      }
      steps.push({ name: "cleanup_storage", status: "succeeded", detail: `attempted=${attemptedFiles} deleted=${deletedFiles} missing=${missingFiles}` });

      // 3. repits (drafts + published)
      try {
        const r = await this.repits.delete({ userId: user.id });
        deletedRecords += r.affected ?? 0;
        steps.push({ name: "delete_repits", status: "succeeded", detail: `${r.affected ?? 0} removed` });
      } catch (e) { return await fail("delete_repits", (e as Error).message); }

      // 4. invalidate sessions (stateless JWT → bump session version)
      try {
        await this.users.update({ id: user.id }, { sessionVersion: (user.sessionVersion ?? 0) + 1 });
        steps.push({ name: "invalidate_sessions", status: "succeeded" });
      } catch (e) { return await fail("invalidate_sessions", (e as Error).message); }

      // 5. delete user row
      try {
        const r = await this.users.delete({ id: user.id });
        deletedRecords += r.affected ?? 0;
        steps.push({ name: "delete_user", status: "succeeded" });
      } catch (e) { return await fail("delete_user", (e as Error).message); }

      steps.push({ name: "finalize", status: "succeeded" });
      job.status = "succeeded";
      job.finishedAt = new Date();
      job.durationMs = Date.now() - started;
      job.result = { outcome: "succeeded", steps, deletedRecords, deletedFiles };
      await this.jobs.save(job);
      // Reaching here means every step (incl. storage cleanup) fully succeeded,
      // so "verified" is honest. Correctly named account-deletion event.
      await this.workflow.recordFulfilment(request.id, {
        method: "automated_deletion",
        result: "succeeded",
        verificationStatus: "verified",
        internalNotes: `${deletedRecords} records, ${deletedFiles} files removed`,
        timelineType: "deletion.executed",
      }, ctx);
      return job;
    } catch (e) {
      return await fail("unexpected", (e as Error).message);
    }
  }

  // ── Export executor (WS5): assemble package + temp download token ────────
  async runExport(request: PrivacyRequest, ctx: TransitionContext = {}): Promise<PrivacyJob> {
    await this.purgeExpiredExportPackages();
    const job = await this.newJob(request.id, "data_export");
    const started = Date.now();
    let deliverySucceeded = false;
    try {
      const user = await this.users.findOne({ where: { id: request.userId } });
      if (!user) throw new NotFoundException("User no longer exists");
      const repits = await this.repits.find({ where: { userId: request.userId } });
      const support = request.userEmail ? await this.support.find({ where: { email: request.userEmail } }) : [];
      const auditEvents = await this.auditLogs.find({ where: { targetType: "user", targetId: request.userId }, order: { createdAt: "ASC" }, take: 1000 });

      // Excludes internal admin notes, secrets, and any other user's data.
      const pkg = {
        generatedAt: new Date().toISOString(),
        userProfile: user ? { id: user.id, fullName: user.fullName, email: user.email, country: user.country, connectedPlatforms: user.connectedPlatforms, createdAt: user.createdAt } : null,
        preferences: user ? { country: user.country, connectedPlatforms: user.connectedPlatforms } : null,
        repits: repits.map((r) => ({ id: r.id, title: r.title, status: r.status, templateId: r.templateId, createdAt: r.createdAt })),
        templatesUsed: Array.from(new Set(repits.map((r) => r.templateId).filter(Boolean))),
        supportHistory: support.map((s) => ({ id: s.id, subject: s.subject, status: s.status, createdAt: s.createdAt })),
        auditEvents: auditEvents.map((a) => ({ action: a.action, at: a.createdAt })),
      };

      // Only a HASH of the download token is persisted — never the plaintext.
      // The plaintext is delivered to the data subject through the configured
      // email channel; it is not retrievable through the admin. The package is
      // stored only until download/expiry and is redacted from ordinary responses.
      const downloadToken = randomBytes(24).toString("hex");
      const downloadTokenHash = createHash("sha256").update(downloadToken).digest("hex");
      const expiresAt = new Date(Date.now() + EXPORT_TTL_MS);
      job.result = {
        outcome: "generated",
        packageSummary: { repits: pkg.repits.length, supportCases: pkg.supportHistory.length, auditEvents: pkg.auditEvents.length },
        package: pkg,
        generatedAt: pkg.generatedAt,
      };
      job.downloadTokenHash = downloadTokenHash;
      job.downloadExpiresAt = expiresAt;
      job.downloadedAt = null;
      await this.jobs.save(job);

      const publicUrl = (
        this.config.get<string>("PUBLIC_URL")
        ?? `http://localhost:${this.config.get<string>("PORT") ?? "4000"}`
      ).replace(/\/+$/, "");
      const downloadUrl = `${publicUrl}/api/privacy/export/${encodeURIComponent(downloadToken)}`;
      await this.mail.sendPrivacyExportReady(
        user.email,
        user.fullName || "there",
        downloadUrl,
        expiresAt,
      );
      deliverySucceeded = true;

      job.status = "succeeded";
      job.finishedAt = new Date();
      job.durationMs = Date.now() - started;
      job.result = { ...job.result, outcome: "succeeded", deliveredAt: new Date().toISOString() };
      await this.jobs.save(job);
      await this.workflow.recordFulfilment(request.id, {
        method: "data_export",
        result: "generated_and_delivered",
        verificationStatus: "verified",
        internalNotes: `Package: ${pkg.repits.length} repits`,
        timelineType: "export.generated",
      }, ctx);
      return job;
    } catch (e) {
      job.status = "retry_required";
      job.finishedAt = new Date();
      job.durationMs = Date.now() - started;
      job.lastError = (e as Error).message;
      job.result = {
        ...(deliverySucceeded ? (job.result ?? {}) : {}),
        outcome: deliverySucceeded ? "delivered_but_not_finalized" : "failed",
        failureReason: (e as Error).message,
      };
      if (!deliverySucceeded) {
        job.downloadTokenHash = null;
        job.downloadExpiresAt = null;
      }
      await this.jobs.save(job);
      await this.workflow.markFailed(request.id, `Export failed: ${(e as Error).message}`, ctx);
      return job;
    }
  }

  /**
   * Serve a generated export by its temporary token. The provided token is
   * hashed and matched against the stored hash (constant-time-ish via hash
   * equality) — the plaintext token is never persisted, logged, or returned.
   * The opaque link is the data subject's authority and expires after 24 hours.
   */
  async downloadExport(token: string): Promise<{ package: unknown; requestId: string }> {
    await this.purgeExpiredExportPackages();
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const job = await this.jobs
      .createQueryBuilder("job")
      .addSelect("job.downloadTokenHash")
      .where("job.type = :type", { type: "data_export" })
      .andWhere("job.downloadTokenHash = :tokenHash", { tokenHash })
      .getOne();
    if (!job) throw new NotFoundException("Export not found or token invalid");
    if (!job.downloadExpiresAt || Date.now() > job.downloadExpiresAt.getTime()) {
      throw new NotFoundException("Export not found or token invalid");
    }
    const result = job.result as Record<string, unknown> | null;
    if (!result?.package) throw new NotFoundException("Export package is unavailable");

    await this.dataSource.transaction(async (manager) => {
      const jobs = manager.getRepository(PrivacyJob);
      const locked = await jobs.findOne({
        where: { id: job.id },
        lock: { mode: "pessimistic_write" },
      });
      if (!locked) throw new NotFoundException("Export package is unavailable");
      if (locked.downloadedAt) {
        throw new NotFoundException("Export link has already been used");
      }
      locked.downloadedAt = new Date();
      locked.downloadTokenHash = null;
      locked.downloadExpiresAt = null;
      if (locked.result) {
        const { package: _discardedPackage, ...retainedResult } = locked.result;
        locked.result = retainedResult;
      }
      await jobs.save(locked);
      await this.workflow.appendEventWithManager(
        manager,
        locked.requestId,
        "export.downloaded",
        { message: "Export downloaded" },
      );
    });
    return { package: result.package, requestId: job.requestId };
  }
}
