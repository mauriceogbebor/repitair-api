import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  AccountDeletionRequest,
  AccountDeletionStatus,
  DeletionAuditEntry,
} from "../../entities/account-deletion-request.entity";

/**
 * Legacy account-deletion queue writer. Self-service consumer account deletion
 * (UsersService.deleteUser) records a completed row here for audit. Admin-managed
 * privacy requests (export / deletion / access / correction) now run through the
 * full workflow engine (PrivacyWorkflowService + PrivacyExecutionService) on the
 * privacy_requests / privacy_jobs tables — see PrivacyQueryService.
 */
@Injectable()
export class PrivacyService {
  constructor(
    @InjectRepository(AccountDeletionRequest)
    private readonly deletionRepo: Repository<AccountDeletionRequest>,
  ) {}

  async recordAccountDeletion(
    userId: string,
    userEmail?: string | null,
    reason?: string | null,
    status: AccountDeletionStatus = "pending",
  ): Promise<AccountDeletionRequest> {
    const now = new Date();
    const entry: DeletionAuditEntry = { at: now.toISOString(), action: status === "completed" ? "self_service_completed" : "requested", note: reason ?? null };
    const request = this.deletionRepo.create({
      userId,
      userEmail: userEmail ?? null,
      status,
      reason: reason ?? null,
      completedAt: status === "completed" ? now : null,
      auditHistory: [entry],
    });
    return this.deletionRepo.save(request);
  }

  async listDeletions(status?: AccountDeletionStatus) {
    const where = status ? { status } : {};
    const records = await this.deletionRepo.find({ where, order: { createdAt: "DESC" }, take: 200 });
    return { total: records.length, records };
  }
}
