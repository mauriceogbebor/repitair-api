import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AdminAuditLog, PushToken, Repit, User } from "../../../entities";
import { AdminAuditLogsService } from "../audit-logs/admin-audit-logs.service";
import type { AdminRequestActor, AdminRequestContext } from "../admin.types";
import { createCsv } from "../utils/csv";
import { AdminListUsersQueryDto } from "./dto/admin-list-users-query.dto";
import { AdminSuspendUserDto } from "./dto/admin-suspend-user.dto";
import { AdminReactivateUserDto } from "./dto/admin-reactivate-user.dto";
import { AdminUpdateUserDto } from "./dto/admin-update-user.dto";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const EXPORT_LIMIT = 10_000;

function normalizeDateInput(value?: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

@Injectable()
export class AdminUsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Repit)
    private readonly repitRepository: Repository<Repit>,
    @InjectRepository(PushToken)
    private readonly pushTokenRepository: Repository<PushToken>,
    @InjectRepository(AdminAuditLog)
    private readonly adminAuditLogRepository: Repository<AdminAuditLog>,
    private readonly auditLogsService: AdminAuditLogsService,
  ) {}

  async listUsers(query: AdminListUsersQueryDto) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(query.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const search = query.search?.trim() ?? "";
    const signupFrom = normalizeDateInput(query.signupFrom);
    const signupTo = normalizeDateInput(query.signupTo);

    if ((query.signupFrom && !signupFrom) || (query.signupTo && !signupTo)) {
      throw new BadRequestException("Invalid signup date filter");
    }

    const countQb = this.userRepository.createQueryBuilder("user");
    this.applyUserFilters(countQb, { search, status: query.status, signupFrom, signupTo });
    const total = await countQb.getCount();

    const qb = this.userRepository
      .createQueryBuilder("user")
      .leftJoin("user.repits", "repit")
      .leftJoin("user.pushTokens", "pushToken")
      .select([
        "user.id AS id",
        "user.fullName AS full_name",
        "user.email AS email",
        "user.country AS country",
        "user.createdAt AS created_at",
        "user.lastLoginAt AS last_login_at",
        "user.connectedPlatforms AS connected_platforms",
        "user.isSuspended AS is_suspended",
        "user.signupSource AS signup_source",
      ])
      .addSelect("COUNT(DISTINCT repit.id)", "repit_count")
      .addSelect("COUNT(DISTINCT pushToken.id)", "push_token_count")
      .addSelect("MAX(pushToken.updatedAt)", "last_push_token_at")
      .groupBy("user.id");

    this.applyUserFilters(qb, { search, status: query.status, signupFrom, signupTo });
    this.applyUserSorting(qb, query.sortBy, query.sortOrder);
    qb.offset((page - 1) * pageSize).limit(pageSize);

    const rows = await qb.getRawMany<Record<string, unknown>>();

    return {
      total,
      page,
      pageSize,
      records: rows.map((row) => this.serializeUserListRow(row)),
    };
  }

  async exportUsers(
    query: AdminListUsersQueryDto,
    actor?: AdminRequestActor | null,
    context?: AdminRequestContext | null,
  ) {
    const search = query.search?.trim() ?? "";
    const signupFrom = normalizeDateInput(query.signupFrom);
    const signupTo = normalizeDateInput(query.signupTo);
    if ((query.signupFrom && !signupFrom) || (query.signupTo && !signupTo)) {
      throw new BadRequestException("Invalid signup date filter");
    }

    const qb = this.userRepository
      .createQueryBuilder("user")
      .leftJoin("user.repits", "repit")
      .leftJoin("user.pushTokens", "pushToken")
      .select([
        "user.id AS id",
        "user.fullName AS full_name",
        "user.email AS email",
        "user.country AS country",
        "user.createdAt AS created_at",
        "user.lastLoginAt AS last_login_at",
        "user.connectedPlatforms AS connected_platforms",
        "user.isSuspended AS is_suspended",
        "user.signupSource AS signup_source",
      ])
      .addSelect("COUNT(DISTINCT repit.id)", "repit_count")
      .addSelect("COUNT(DISTINCT pushToken.id)", "push_token_count")
      .addSelect("MAX(pushToken.updatedAt)", "last_push_token_at")
      .groupBy("user.id");

    this.applyUserFilters(qb, { search, status: query.status, signupFrom, signupTo });
    this.applyUserSorting(qb, query.sortBy, query.sortOrder);
    qb.limit(EXPORT_LIMIT + 1);

    const rows = await qb.getRawMany<Record<string, unknown>>();
    const truncated = rows.length > EXPORT_LIMIT;
    const records = rows.slice(0, EXPORT_LIMIT).map((row) => this.serializeUserListRow(row));
    const csv = createCsv(
      ["User ID", "Full name", "Email", "Country", "Status", "Signed up", "Last login", "Signup source", "Repit count", "Connected providers", "Push notifications"],
      records.map((record) => [
        record.id,
        record.fullName,
        record.email,
        record.country,
        record.status,
        record.createdAt,
        record.lastLoginAt,
        record.signupSource,
        record.repitCount,
        record.connectedProviders.join("; "),
        record.pushTokenPresent ? "enabled" : "not registered",
      ]),
    );
    const { page: _page, pageSize: _pageSize, ...filters } = query;

    await this.auditLogsService.append({
      action: "admin.users.exported",
      actor,
      context,
      targetType: "user-export",
      metadata: { filters, resultCount: records.length, truncated, limit: EXPORT_LIMIT },
    });

    return {
      csv,
      filename: `repitair-users-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`,
      resultCount: records.length,
      truncated,
      limit: EXPORT_LIMIT,
    };
  }

  async getUserDetail(userId: string) {
    const user = await this.userRepository
      .createQueryBuilder("user")
      .addSelect(["user.spotifyRefreshToken", "user.appleMusicUserToken"])
      .leftJoinAndSelect("user.pushTokens", "pushToken")
      .where("user.id = :userId", { userId })
      .getOne();

    if (!user) {
      throw new NotFoundException("User not found");
    }

    const repitCount = await this.repitRepository.count({ where: { userId } });

    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      country: user.country,
      avatarUrl: user.avatarUrl ?? null,
      createdAt: user.createdAt,
      signupSource: user.signupSource ?? null,
      status: user.isSuspended ? "suspended" : "active",
      suspensionReason: user.suspensionReason ?? null,
      suspendedAt: user.suspendedAt ?? null,
      repitCount,
      connectedProviders: user.connectedPlatforms,
      connectedProviderState: {
        spotify: Boolean(user.spotifyRefreshToken) || user.connectedPlatforms.includes("spotify"),
        appleMusic:
          Boolean(user.appleMusicUserToken) ||
          user.connectedPlatforms.includes("apple-music") ||
          user.connectedPlatforms.includes("apple music"),
      },
      pushTokenPresent: user.pushTokens.length > 0,
      pushTokenCount: user.pushTokens.length,
      lastPushTokenAt: user.pushTokens.reduce<string | null>((latest, token) => {
        const nextValue = token.updatedAt?.toISOString?.() ?? null;
        if (!nextValue) return latest;
        return !latest || nextValue > latest ? nextValue : latest;
      }, null),
      lastLoginAt: user.lastLoginAt ?? null,
      internalNotesImplemented: false,
      internalNotes: [],
    };
  }

  async updateUser(
    userId: string,
    dto: AdminUpdateUserDto,
    actor?: AdminRequestActor | null,
    context?: AdminRequestContext | null,
  ) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException("User not found");
    }

    if (dto.email && dto.email.toLowerCase() !== user.email.toLowerCase()) {
      const existing = await this.userRepository.findOne({ where: { email: dto.email.toLowerCase() } });
      if (existing && existing.id !== user.id) {
        throw new ConflictException("A user with this email already exists");
      }
    }

    const beforeState = this.buildUserAuditSnapshot(user);

    if (dto.fullName !== undefined) user.fullName = dto.fullName;
    if (dto.email !== undefined) user.email = dto.email.toLowerCase();
    if (dto.country !== undefined) user.country = dto.country;

    const saved = await this.userRepository.save(user);

    await this.auditLogsService.append({
      action: "admin.users.updated",
      actor,
      context,
      targetType: "user",
      targetId: user.id,
      beforeState,
      afterState: this.buildUserAuditSnapshot(saved),
    });

    return this.getUserDetail(saved.id);
  }

  async suspendUser(
    userId: string,
    dto: AdminSuspendUserDto,
    actor?: AdminRequestActor | null,
    context?: AdminRequestContext | null,
  ) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException("User not found");
    }

    const beforeState = this.buildUserAuditSnapshot(user);
    user.isSuspended = true;
    user.suspensionReason = dto.reason;
    user.suspendedAt = new Date();

    const saved = await this.userRepository.save(user);
    await this.auditLogsService.append({
      action: "admin.users.suspended",
      actor,
      context,
      targetType: "user",
      targetId: user.id,
      beforeState,
      afterState: this.buildUserAuditSnapshot(saved),
      metadata: { reason: dto.reason },
    });

    return this.getUserDetail(saved.id);
  }

  async reactivateUser(
    userId: string,
    dto: AdminReactivateUserDto,
    actor?: AdminRequestActor | null,
    context?: AdminRequestContext | null,
  ) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException("User not found");
    }

    const beforeState = this.buildUserAuditSnapshot(user);
    user.isSuspended = false;
    user.suspensionReason = null;
    user.suspendedAt = null;

    const saved = await this.userRepository.save(user);
    await this.auditLogsService.append({
      action: "admin.users.reactivated",
      actor,
      context,
      targetType: "user",
      targetId: user.id,
      beforeState,
      afterState: this.buildUserAuditSnapshot(saved),
      metadata: dto.reason ? { reason: dto.reason } : null,
    });

    return this.getUserDetail(saved.id);
  }

  async getUserActivity(userId: string) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException("User not found");
    }

    const [repits, pushTokens, auditLogs] = await Promise.all([
      this.repitRepository.find({
        where: { userId },
        order: { createdAt: "DESC" },
        take: 20,
      }),
      this.pushTokenRepository.find({
        where: { userId },
        order: { updatedAt: "DESC" },
        take: 10,
      }),
      this.adminAuditLogRepository.find({
        where: { targetType: "user", targetId: userId },
        order: { createdAt: "DESC" },
        take: 20,
      }),
    ]);

    const events = [
      {
        id: `user-created-${user.id}`,
        type: "account_created",
        occurredAt: user.createdAt,
        label: "Account created",
        detail: user.signupSource ? `Signup source: ${user.signupSource}` : "Consumer account created",
      },
      ...repits.map((repit) => ({
        id: `repit-${repit.id}`,
        type: "repit_created",
        occurredAt: repit.createdAt,
        label: "Repit created",
        detail: `${repit.title} · ${repit.templateId}`,
      })),
      ...pushTokens.map((token) => ({
        id: `push-token-${token.id}`,
        type: "push_token_updated",
        occurredAt: token.updatedAt,
        label: "Push token updated",
        detail: `${token.platform} token present`,
      })),
      ...auditLogs.map((log) => ({
        id: `audit-${log.id}`,
        type: "admin_action",
        occurredAt: log.createdAt,
        label: log.action,
        detail: log.actorEmail ? `By ${log.actorEmail}` : "Admin action recorded",
      })),
    ]
      .sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime())
      .map((event) => ({
        ...event,
        occurredAt: new Date(event.occurredAt).toISOString(),
      }));

    return { total: events.length, events };
  }

  async getUserDiagnostics(userId: string) {
    const user = await this.userRepository
      .createQueryBuilder("user")
      .addSelect(["user.spotifyRefreshToken", "user.appleMusicUserToken"])
      .leftJoinAndSelect("user.pushTokens", "pushToken")
      .where("user.id = :userId", { userId })
      .getOne();

    if (!user) {
      throw new NotFoundException("User not found");
    }

    const recentRepits = await this.repitRepository.find({
      where: { userId },
      order: { createdAt: "DESC" },
      take: 5,
    });

    return {
      accountStatus: user.isSuspended ? "suspended" : "active",
      suspensionReason: user.suspensionReason ?? null,
      authState: {
        emailVerified: user.emailVerified,
        lastLoginAt: user.lastLoginAt ?? null,
        signupSource: user.signupSource ?? null,
        passwordResetPending: Boolean(user.resetToken),
      },
      connectedProviders: {
        spotify: {
          connected: Boolean(user.spotifyRefreshToken) || user.connectedPlatforms.includes("spotify"),
        },
        appleMusic: {
          connected:
            Boolean(user.appleMusicUserToken) ||
            user.connectedPlatforms.includes("apple-music") ||
            user.connectedPlatforms.includes("apple music"),
        },
      },
      pushTokens: {
        present: user.pushTokens.length > 0,
        count: user.pushTokens.length,
        platforms: Array.from(new Set(user.pushTokens.map((token) => token.platform))),
        lastUpdatedAt: user.pushTokens
          .map((token) => token.updatedAt?.toISOString?.() ?? null)
          .filter((value): value is string => Boolean(value))
          .sort()
          .at(-1) ?? null,
      },
      recentRepits: recentRepits.map((repit) => ({
        id: repit.id,
        title: repit.title,
        templateId: repit.templateId,
        status: repit.status,
        moderationStatus: repit.moderationStatus,
        createdAt: repit.createdAt,
      })),
      internalNotesImplemented: false,
    };
  }

  private applyUserFilters(
    qb: ReturnType<Repository<User>["createQueryBuilder"]>,
    filters: {
      search?: string;
      status?: string;
      signupFrom?: Date | null;
      signupTo?: Date | null;
    },
  ) {
    if (filters.search) {
      qb.andWhere(
        "(user.id::text ILIKE :search OR user.email ILIKE :search OR user.fullName ILIKE :search)",
        { search: `%${filters.search}%` },
      );
    }

    if (filters.status === "active") {
      qb.andWhere("user.isSuspended = false");
    } else if (filters.status === "suspended") {
      qb.andWhere("user.isSuspended = true");
    }

    if (filters.signupFrom) {
      qb.andWhere("user.createdAt >= :signupFrom", { signupFrom: filters.signupFrom.toISOString() });
    }

    if (filters.signupTo) {
      qb.andWhere("user.createdAt <= :signupTo", { signupTo: filters.signupTo.toISOString() });
    }
  }

  private applyUserSorting(
    qb: ReturnType<Repository<User>["createQueryBuilder"]>,
    sortBy?: string,
    sortOrder?: string,
  ) {
    const order = sortOrder?.toUpperCase() === "ASC" ? "ASC" : "DESC";

    switch (sortBy) {
      case "fullName":
        qb.orderBy("user.fullName", order);
        break;
      case "email":
        qb.orderBy("user.email", order);
        break;
      case "lastLoginAt":
        qb.orderBy("user.lastLoginAt", order as "ASC" | "DESC", "NULLS LAST");
        break;
      case "repitCount":
        qb.orderBy("repit_count", order);
        break;
      default:
        qb.orderBy("user.createdAt", order);
        break;
    }
  }

  private buildUserAuditSnapshot(user: User) {
    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      country: user.country,
      isSuspended: user.isSuspended,
      suspensionReason: user.suspensionReason ?? null,
      suspendedAt: user.suspendedAt?.toISOString?.() ?? null,
      lastLoginAt: user.lastLoginAt?.toISOString?.() ?? null,
    };
  }

  private serializeUserListRow(row: Record<string, unknown>) {
    return {
      id: String(row.id),
      fullName: String(row.full_name ?? ""),
      email: String(row.email ?? ""),
      country: String(row.country ?? ""),
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at,
      signupSource: row.signup_source ?? null,
      status: Boolean(row.is_suspended) ? "suspended" : "active",
      repitCount: Number(row.repit_count ?? 0),
      connectedProviders: this.parseTextArray(row.connected_platforms),
      pushTokenPresent: Number(row.push_token_count ?? 0) > 0,
      lastPushTokenAt: row.last_push_token_at ?? null,
    };
  }

  private parseTextArray(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.filter((entry): entry is string => typeof entry === "string");
    }

    if (typeof value === "string") {
      return value
        .replace(/^{|}$/g, "")
        .split(",")
        .map((entry) => entry.replace(/^"|"$/g, "").trim())
        .filter(Boolean);
    }

    return [];
  }
}
