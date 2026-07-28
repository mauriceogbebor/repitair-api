import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, Repository, SelectQueryBuilder } from "typeorm";
import { AdminAuditLog } from "../../../entities/admin-audit-log.entity";
import type { AdminRequestActor, AdminRequestContext } from "../admin.types";
import { createCsv } from "../utils/csv";
import { AdminListAuditLogsQueryDto } from "./dto/admin-list-audit-logs-query.dto";

const AUDIT_EXPORT_LIMIT = 5_000;
const REDACTED = "[REDACTED]";
const SENSITIVE_KEY = /(password|hash|token|secret|authorization|cookie|csrf|mfa|private.?key)/i;

type SafeAuditValue = string | number | boolean | null | SafeAuditValue[] | { [key: string]: SafeAuditValue };

type AuditChange = {
  path: string;
  before: SafeAuditValue | null;
  after: SafeAuditValue | null;
  kind: "added" | "removed" | "changed";
};

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

  async append(input: AdminAuditLogInput, manager?: EntityManager): Promise<AdminAuditLog> {
    const repository = manager?.getRepository(AdminAuditLog) ?? this.auditLogRepository;
    const entity = repository.create({
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
      metadata: input.actor?.breakGlass
        ? {
            ...(input.metadata ?? {}),
            breakGlass: {
              grantId: input.actor.breakGlass.grantId,
              expiresAt: input.actor.breakGlass.expiresAt,
            },
          }
        : input.metadata ?? null,
    });

    return repository.save(entity);
  }

  async list(query: AdminListAuditLogsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const qb = this.applyFilters(this.auditLogRepository.createQueryBuilder("audit"), query);
    qb.orderBy("audit.createdAt", query.sortOrder === "asc" ? "ASC" : "DESC")
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [records, total] = await qb.getManyAndCount();
    return {
      total,
      page,
      pageSize,
      records: records.map((record) => this.toListItem(record)),
    };
  }

  async getDetail(id: string, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    const record = await this.auditLogRepository.findOne({ where: { id } });
    if (!record) throw new NotFoundException("Audit event not found");

    const beforeState = this.sanitizeValue(record.beforeState ?? null);
    const afterState = this.sanitizeValue(record.afterState ?? null);
    const metadata = this.sanitizeValue(record.metadata ?? null);

    await this.append({
      action: "admin.audit.viewed",
      actor,
      context,
      targetType: "audit_log",
      targetId: record.id,
      metadata: { viewedAction: record.action },
    });

    return {
      ...this.toListItem(record),
      request: {
        requestId: record.requestId ?? null,
        method: record.method ?? null,
        path: record.path ?? null,
      },
      beforeState,
      afterState,
      metadata,
      changes: this.buildChanges(beforeState, afterState),
    };
  }

  async export(query: AdminListAuditLogsQueryDto, actor?: AdminRequestActor | null, context?: AdminRequestContext | null) {
    const qb = this.applyFilters(this.auditLogRepository.createQueryBuilder("audit"), query);
    const records = await qb.orderBy("audit.createdAt", query.sortOrder === "asc" ? "ASC" : "DESC")
      .take(AUDIT_EXPORT_LIMIT + 1)
      .getMany();
    const truncated = records.length > AUDIT_EXPORT_LIMIT;
    const exported = records.slice(0, AUDIT_EXPORT_LIMIT);
    const csv = createCsv(
      ["Timestamp", "Actor", "Action", "Target type", "Target ID", "Request ID", "Method", "Path"],
      exported.map((record) => [
        record.createdAt,
        record.actorEmail ?? "System",
        record.action,
        record.targetType,
        record.targetId,
        record.requestId,
        record.method,
        record.path,
      ]),
    );

    await this.append({
      action: "admin.audit.exported",
      actor,
      context,
      targetType: "audit-export",
      metadata: {
        filters: this.safeFilterMetadata(query),
        resultCount: exported.length,
        truncated,
        limit: AUDIT_EXPORT_LIMIT,
      },
    });

    return {
      csv,
      filename: `repitair-audit-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`,
      resultCount: exported.length,
      truncated,
      limit: AUDIT_EXPORT_LIMIT,
    };
  }

  async count(): Promise<number> {
    return this.auditLogRepository.count();
  }

  private applyFilters(qb: SelectQueryBuilder<AdminAuditLog>, query: AdminListAuditLogsQueryDto) {
    const search = query.search?.trim();
    if (search) {
      qb.andWhere(
        "(audit.action ILIKE :search OR audit.actorEmail ILIKE :search OR audit.targetType ILIKE :search OR audit.targetId ILIKE :search OR audit.requestId ILIKE :search OR audit.path ILIKE :search)",
        { search: `%${search}%` },
      );
    }
    if (query.module) qb.andWhere("audit.action LIKE :module", { module: `admin.${query.module}.%` });
    if (query.actor?.trim()) qb.andWhere("audit.actorEmail ILIKE :actor", { actor: `%${query.actor.trim()}%` });
    if (query.targetType?.trim()) qb.andWhere("audit.targetType = :targetType", { targetType: query.targetType.trim() });
    if (query.createdFrom) qb.andWhere("audit.createdAt >= :createdFrom", { createdFrom: new Date(`${query.createdFrom}T00:00:00.000Z`) });
    if (query.createdTo) qb.andWhere("audit.createdAt <= :createdTo", { createdTo: new Date(`${query.createdTo}T23:59:59.999Z`) });
    return qb;
  }

  private toListItem(record: AdminAuditLog) {
    return {
      id: record.id,
      action: record.action,
      module: record.action.split(".")[1] ?? "system",
      actor: record.actorAdminUserId || record.actorEmail
        ? { id: record.actorAdminUserId ?? null, email: record.actorEmail ?? null }
        : null,
      target: record.targetType || record.targetId
        ? { type: record.targetType ?? null, id: record.targetId ?? null }
        : null,
      requestId: record.requestId ?? null,
      method: record.method ?? null,
      path: record.path ?? null,
      createdAt: record.createdAt,
    };
  }

  private sanitizeValue(value: unknown, depth = 0): SafeAuditValue | null {
    if (value === null || value === undefined) return null;
    if (depth > 8) return "[TRUNCATED]";
    if (["string", "number", "boolean"].includes(typeof value)) return value as string | number | boolean;
    if (Array.isArray(value)) return value.slice(0, 100).map((item) => this.sanitizeValue(item, depth + 1));
    if (typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).slice(0, 200).map(([key, item]) => [
          key,
          SENSITIVE_KEY.test(key) ? REDACTED : this.sanitizeValue(item, depth + 1),
        ]),
      );
    }
    return String(value);
  }

  private buildChanges(before: SafeAuditValue | null, after: SafeAuditValue | null): AuditChange[] {
    const changes: AuditChange[] = [];
    const walk = (previous: SafeAuditValue | null, next: SafeAuditValue | null, path: string, depth: number) => {
      if (changes.length >= 200 || depth > 8 || JSON.stringify(previous) === JSON.stringify(next)) return;
      const previousObject = previous && typeof previous === "object" && !Array.isArray(previous) ? previous : null;
      const nextObject = next && typeof next === "object" && !Array.isArray(next) ? next : null;
      if (previousObject || nextObject) {
        const keys = new Set([...Object.keys(previousObject ?? {}), ...Object.keys(nextObject ?? {})]);
        for (const key of keys) {
          walk(previousObject?.[key] ?? null, nextObject?.[key] ?? null, path ? `${path}.${key}` : key, depth + 1);
        }
        return;
      }
      changes.push({
        path: path || "value",
        before: previous,
        after: next,
        kind: previous === null ? "added" : next === null ? "removed" : "changed",
      });
    };
    walk(before, after, "", 0);
    return changes;
  }

  private safeFilterMetadata(query: AdminListAuditLogsQueryDto) {
    const { page: _page, pageSize: _pageSize, ...filters } = query;
    return filters;
  }
}
