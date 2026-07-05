import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AdminAuditLog } from "../../../entities/admin-audit-log.entity";
import type { AdminRequestActor, AdminRequestContext } from "../admin.types";

export type AdminAuditLogInput = {
  action: string;
  actor?: AdminRequestActor | null;
  context?: AdminRequestContext | null;
  targetType?: string | null;
  targetId?: string | null;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

@Injectable()
export class AdminAuditLogsService {
  constructor(
    @InjectRepository(AdminAuditLog)
    private readonly auditLogRepository: Repository<AdminAuditLog>,
  ) {}

  async append(input: AdminAuditLogInput): Promise<AdminAuditLog> {
    const entity = this.auditLogRepository.create({
      action: input.action,
      actorAdminUserId: input.actor?.id ?? null,
      actorEmail: input.actor?.email ?? null,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      requestId: input.context?.requestId ?? null,
      method: input.context?.method ?? null,
      path: input.context?.path ?? null,
      ipAddress: input.context?.ipAddress ?? null,
      userAgent: input.context?.userAgent ?? null,
      beforeState: input.beforeState ?? null,
      afterState: input.afterState ?? null,
      metadata: input.metadata ?? null,
    });

    return this.auditLogRepository.save(entity);
  }

  async listRecent(limit = 50): Promise<AdminAuditLog[]> {
    return this.auditLogRepository.find({
      order: { createdAt: "DESC" },
      take: Math.max(1, Math.min(limit, 100)),
    });
  }

  async count(): Promise<number> {
    return this.auditLogRepository.count();
  }
}
