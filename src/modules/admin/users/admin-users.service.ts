import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import {
  AdminAuditLog,
  ContactSubmission,
  PushToken,
  Repit,
  User,
  UserOperationalNote,
  UserRecoveryOperation,
  UserRestriction,
} from "../../../entities";
import { AuthService } from "../../auth/auth.service";
import { AdminAuditLogsService } from "../audit-logs/admin-audit-logs.service";
import type { AdminRequestActor, AdminRequestContext } from "../admin.types";
import { createCsv } from "../utils/csv";
import { AdminListUsersQueryDto } from "./dto/admin-list-users-query.dto";
import { AdminSuspendUserDto } from "./dto/admin-suspend-user.dto";
import { AdminReactivateUserDto } from "./dto/admin-reactivate-user.dto";
import { AdminUpdateUserDto } from "./dto/admin-update-user.dto";
import { AdminAddUserNoteDto } from "./dto/admin-add-user-note.dto";
import { AdminUserRecoveryDto } from "./dto/admin-user-recovery.dto";
import { resolveDateRange } from "../utils/date-range";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const EXPORT_LIMIT = 10_000;

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
    @InjectRepository(ContactSubmission)
    private readonly supportTicketRepository: Repository<ContactSubmission>,
    @InjectRepository(UserOperationalNote)
    private readonly userNoteRepository: Repository<UserOperationalNote>,
    @InjectRepository(UserRestriction)
    private readonly restrictionRepository: Repository<UserRestriction>,
    @InjectRepository(UserRecoveryOperation)
    private readonly recoveryRepository: Repository<UserRecoveryOperation>,
    private readonly auditLogsService: AdminAuditLogsService,
    private readonly authService: AuthService,
    private readonly dataSource: DataSource,
  ) {}

  async listUsers(query: AdminListUsersQueryDto, actor?: AdminRequestActor | null) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(query.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const search = query.search?.trim() ?? "";
    const { start: signupFrom, endExclusive: signupToExclusive } = resolveDateRange(
      query.signupFrom,
      query.signupTo,
      "signup",
    );
    const includePii = this.hasPermission(actor, "users.read_pii");

    const countQb = this.userRepository.createQueryBuilder("user");
    this.applyUserFilters(countQb, { search, status: query.status, verification: query.verification, restriction: query.restriction, signupFrom, signupToExclusive, includePii });
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
        "user.emailVerified AS email_verified",
      ])
      .addSelect("COUNT(DISTINCT repit.id)", "repit_count")
      .addSelect("COUNT(DISTINCT pushToken.id)", "push_token_count")
      .addSelect("MAX(pushToken.updatedAt)", "last_push_token_at")
      .addSelect(
        `GREATEST(
          COALESCE(MAX("repit"."createdAt"), "user"."createdAt"),
          COALESCE(MAX("pushToken"."updatedAt"), "user"."createdAt"),
          COALESCE("user"."lastLoginAt", "user"."createdAt")
        )`,
        "last_activity_at",
      )
      .addSelect(`(SELECT COUNT(*) FROM contact_submissions support_case WHERE support_case."relatedUserId" = "user"."id"::text AND support_case.status NOT IN ('resolved', 'closed'))`, "open_case_count")
      .addSelect(`(SELECT COUNT(*) FROM user_restrictions active_restriction WHERE active_restriction."userId" = "user"."id" AND active_restriction.status = 'active')`, "active_restriction_count")
      .groupBy("user.id");

    this.applyUserFilters(qb, { search, status: query.status, verification: query.verification, restriction: query.restriction, signupFrom, signupToExclusive, includePii });
    this.applyUserSorting(qb, query.sortBy, query.sortOrder, includePii);
    qb.offset((page - 1) * pageSize).limit(pageSize);

    const rows = await qb.getRawMany<Record<string, unknown>>();

    return {
      total,
      page,
      pageSize,
      records: rows.map((row) => this.serializeUserListRow(row, includePii)),
    };
  }

  async exportUsers(
    query: AdminListUsersQueryDto,
    actor?: AdminRequestActor | null,
    context?: AdminRequestContext | null,
  ) {
    const search = query.search?.trim() ?? "";
    const { start: signupFrom, endExclusive: signupToExclusive } = resolveDateRange(
      query.signupFrom,
      query.signupTo,
      "signup",
    );
    const includePii = this.hasPermission(actor, "users.read_pii");

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
      .addSelect(`(SELECT COUNT(*) FROM user_restrictions active_restriction WHERE active_restriction."userId" = "user"."id" AND active_restriction.status = 'active')`, "active_restriction_count")
      .groupBy("user.id");

    this.applyUserFilters(qb, { search, status: query.status, verification: query.verification, restriction: query.restriction, signupFrom, signupToExclusive, includePii });
    this.applyUserSorting(qb, query.sortBy, query.sortOrder, includePii);
    qb.limit(EXPORT_LIMIT + 1);

    const rows = await qb.getRawMany<Record<string, unknown>>();
    const truncated = rows.length > EXPORT_LIMIT;
    const records = rows.slice(0, EXPORT_LIMIT).map((row) => this.serializeUserListRow(row, includePii));
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

  async getUserDetail(
    userId: string,
    actor?: AdminRequestActor | null,
    context?: AdminRequestContext | null,
  ) {
    const user = await this.userRepository
      .createQueryBuilder("user")
      .addSelect(["user.spotifyRefreshToken", "user.appleMusicUserToken"])
      .leftJoinAndSelect("user.pushTokens", "pushToken")
      .where("user.id = :userId", { userId })
      .getOne();

    if (!user) {
      throw new NotFoundException("User not found");
    }

    const [repitCount, openCaseCount, activeRestrictionCount] = await Promise.all([
      this.repitRepository.count({ where: { userId } }),
      this.supportTicketRepository
        .createQueryBuilder("support_case")
        .where('support_case."relatedUserId" = :userId', { userId })
        .andWhere("support_case.status NOT IN (:...closedStatuses)", { closedStatuses: ["resolved", "closed"] })
        .getCount(),
      this.restrictionRepository.count({ where: { userId, status: "active" } }),
    ]);
    const canReadPii = this.hasPermission(actor, "users.read_pii");

    if (canReadPii) {
      await this.auditLogsService.append({
        action: "admin.users.pii_viewed",
        actor,
        context,
        targetType: "user",
        targetId: user.id,
        metadata: { fields: ["email", "country"] },
      });
    }

    return {
      id: user.id,
      fullName: user.fullName,
      email: canReadPii ? user.email : null,
      country: canReadPii ? user.country : null,
      avatarUrl: user.avatarUrl ?? null,
      createdAt: user.createdAt,
      signupSource: user.signupSource ?? null,
      status: user.isSuspended ? "suspended" : "active",
      suspensionReason: user.suspensionReason ?? null,
      suspendedAt: user.suspendedAt ?? null,
      repitCount,
      emailVerified: user.emailVerified,
      activeRestrictionCount,
      openCaseCount,
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
      permissions: {
        canReadPii,
        canCreateNotes: this.hasPermission(actor, "users.notes.create"),
        canReadNotes: this.hasPermission(actor, "users.notes.read") || this.hasPermission(actor, "users.notes.create"),
        canManageRestrictions: this.hasPermission(actor, "users.restrictions.manage"),
        canManageRecovery: this.hasPermission(actor, "users.recovery.manage"),
        canRevokeSessions: this.hasPermission(actor, "users.sessions.revoke"),
        canReadDiagnostics: this.hasPermission(actor, "users.diagnostics.read"),
      },
    };
  }

  async updateUser(
    userId: string,
    dto: AdminUpdateUserDto,
    actor?: AdminRequestActor | null,
    context?: AdminRequestContext | null,
  ) {
    const saved = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(User);
      const user = await repository.findOne({ where: { id: userId } });
      if (!user) throw new NotFoundException("User not found");

      if (dto.email && dto.email.toLowerCase() !== user.email.toLowerCase()) {
        const existing = await repository.findOne({ where: { email: dto.email.toLowerCase() } });
        if (existing && existing.id !== user.id) {
          throw new ConflictException("A user with this email already exists");
        }
      }

      const beforeState = this.buildUserAuditSnapshot(user);
      if (dto.fullName !== undefined) user.fullName = dto.fullName;
      if (dto.email !== undefined) user.email = dto.email.toLowerCase();
      if (dto.country !== undefined) user.country = dto.country;
      const updated = await repository.save(user);

      await this.auditLogsService.append({
        action: "admin.users.updated",
        actor,
        context,
        targetType: "user",
        targetId: user.id,
        beforeState,
        afterState: this.buildUserAuditSnapshot(updated),
        metadata: { changedFields: Object.keys(dto) },
      }, manager);
      return updated;
    });

    return this.getUserDetail(saved.id, actor, context);
  }

  async suspendUser(
    userId: string,
    dto: AdminSuspendUserDto,
    actor?: AdminRequestActor | null,
    context?: AdminRequestContext | null,
  ) {
    const saved = await this.dataSource.transaction(async (manager) => {
      const userRepository = manager.getRepository(User);
      const restrictionRepository = manager.getRepository(UserRestriction);
      const user = await userRepository.findOne({ where: { id: userId } });
      if (!user) throw new NotFoundException("User not found");
      if (user.isSuspended) throw new ConflictException("User is already suspended");

      const beforeState = this.buildUserAuditSnapshot(user);
      user.isSuspended = true;
      user.suspensionReason = dto.reason.trim();
      user.suspendedAt = new Date();
      user.sessionVersion = (user.sessionVersion ?? 0) + 1;
      const updated = await userRepository.save(user);
      const restriction = await restrictionRepository.save(restrictionRepository.create({
        userId: user.id,
        type: "account_suspension",
        status: "active",
        reason: dto.reason.trim(),
        policyCategory: "account_access",
        startsAt: updated.suspendedAt ?? new Date(),
        issuedByAdminUserId: actor?.id ?? null,
        issuedByAdminEmail: actor?.email ?? null,
      }));
      await this.auditLogsService.append({
        action: "admin.users.suspended",
        actor,
        context,
        targetType: "user",
        targetId: user.id,
        beforeState,
        afterState: this.buildUserAuditSnapshot(updated),
        metadata: { reason: dto.reason, restrictionId: restriction.id, restrictionType: restriction.type },
      }, manager);
      return updated;
    });

    return this.getUserDetail(saved.id, actor, context);
  }

  async reactivateUser(
    userId: string,
    dto: AdminReactivateUserDto,
    actor?: AdminRequestActor | null,
    context?: AdminRequestContext | null,
  ) {
    const saved = await this.dataSource.transaction(async (manager) => {
      const userRepository = manager.getRepository(User);
      const restrictionRepository = manager.getRepository(UserRestriction);
      const user = await userRepository.findOne({ where: { id: userId } });
      if (!user) throw new NotFoundException("User not found");
      if (!user.isSuspended) throw new ConflictException("User is already active");

      const beforeState = this.buildUserAuditSnapshot(user);
      user.isSuspended = false;
      user.suspensionReason = null;
      user.suspendedAt = null;
      const updated = await userRepository.save(user);
      const activeRestrictions = await restrictionRepository.find({
        where: { userId, type: "account_suspension", status: "active" },
      });
      for (const restriction of activeRestrictions) {
        restriction.status = "revoked";
        restriction.revokedAt = new Date();
        restriction.revokedByAdminUserId = actor?.id ?? null;
        restriction.revokedByAdminEmail = actor?.email ?? null;
        restriction.revocationReason = dto.reason.trim();
      }
      if (activeRestrictions.length) await restrictionRepository.save(activeRestrictions);
      await this.auditLogsService.append({
        action: "admin.users.reactivated",
        actor,
        context,
        targetType: "user",
        targetId: user.id,
        beforeState,
        afterState: this.buildUserAuditSnapshot(updated),
        metadata: { reason: dto.reason, revokedRestrictionIds: activeRestrictions.map((item) => item.id) },
      }, manager);
      return updated;
    });

    return this.getUserDetail(saved.id, actor, context);
  }

  async getUserActivity(userId: string, _actor?: AdminRequestActor | null) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException("User not found");
    }

    const [repits, pushTokens, auditLogs, recoveries] = await Promise.all([
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
      this.recoveryRepository.find({ where: { userId }, order: { createdAt: "DESC" }, take: 20 }),
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
      ...recoveries.map((operation) => ({
        id: `recovery-${operation.id}`,
        type: "recovery_operation",
        occurredAt: operation.createdAt,
        label: operation.type.replaceAll("_", " "),
        detail: `${operation.status}${operation.initiatedByAdminEmail ? ` · By ${operation.initiatedByAdminEmail}` : ""}`,
      })),
    ]
      .sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime())
      .map((event) => ({
        ...event,
        occurredAt: new Date(event.occurredAt).toISOString(),
      }));

    return { total: events.length, events };
  }

  async getUserDiagnostics(
    userId: string,
    actor?: AdminRequestActor | null,
    context?: AdminRequestContext | null,
  ) {
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

    await this.auditLogsService.append({
      action: "admin.users.diagnostics_viewed",
      actor,
      context,
      targetType: "user",
      targetId: user.id,
      metadata: { redacted: true },
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
      sessionVersion: user.sessionVersion,
    };
  }

  async getUserOperations(userId: string, actor?: AdminRequestActor | null) {
    await this.requireUser(userId);
    const [notes, restrictions, recoveries, supportCases] = await Promise.all([
      this.userNoteRepository.find({ where: { userId }, order: { createdAt: "DESC" }, take: 100 }),
      this.restrictionRepository.find({ where: { userId }, order: { createdAt: "DESC" }, take: 100 }),
      this.recoveryRepository.find({ where: { userId }, order: { createdAt: "DESC" }, take: 100 }),
      this.supportTicketRepository.find({ where: { relatedUserId: userId }, order: { createdAt: "DESC" }, take: 50 }),
    ]);

    return {
      notes: (this.hasPermission(actor, "users.notes.read") || this.hasPermission(actor, "users.notes.create")) ? notes.map((note) => ({
        id: note.id,
        body: note.body,
        visibility: note.visibility,
        authorEmail: note.authorAdminEmail ?? null,
        createdAt: note.createdAt,
      })) : [],
      restrictions: restrictions.map((restriction) => ({
        id: restriction.id,
        type: restriction.type,
        status: restriction.status,
        policyCategory: restriction.policyCategory ?? null,
        reason: restriction.reason,
        startsAt: restriction.startsAt,
        issuedByAdminEmail: restriction.issuedByAdminEmail ?? null,
        revokedAt: restriction.revokedAt ?? null,
        revokedByAdminEmail: restriction.revokedByAdminEmail ?? null,
        revocationReason: restriction.revocationReason ?? null,
      })),
      recoveryOperations: this.hasPermission(actor, "users.recovery.manage") ? recoveries.map((operation) => ({
        id: operation.id,
        type: operation.type,
        status: operation.status,
        reason: operation.reason,
        deliveryStatus: operation.deliveryStatus ?? null,
        initiatedByAdminEmail: operation.initiatedByAdminEmail ?? null,
        createdAt: operation.createdAt,
      })) : [],
      supportCases: supportCases.map((supportCase) => ({
        id: supportCase.id,
        subject: supportCase.subject,
        status: supportCase.status,
        priority: supportCase.priority,
        createdAt: supportCase.createdAt,
      })),
    };
  }

  async addUserNote(
    userId: string,
    dto: AdminAddUserNoteDto,
    actor?: AdminRequestActor | null,
    context?: AdminRequestContext | null,
  ) {
    await this.requireUser(userId);
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(UserOperationalNote);
      const note = await repository.save(repository.create({
        userId,
        authorAdminUserId: actor?.id ?? null,
        authorAdminEmail: actor?.email ?? null,
        body: dto.body.trim(),
        visibility: "internal",
      }));
      await this.auditLogsService.append({
        action: "admin.users.note_added",
        actor,
        context,
        targetType: "user",
        targetId: userId,
        metadata: { noteId: note.id, visibility: note.visibility },
      }, manager);
    });
    return this.getUserOperations(userId, actor);
  }

  async performRecovery(
    userId: string,
    dto: AdminUserRecoveryDto,
    actor?: AdminRequestActor | null,
    context?: AdminRequestContext | null,
  ) {
    const user = await this.requireUser(userId);
    if (dto.action === "sessions_revoked" && !this.hasPermission(actor, "users.sessions.revoke")) {
      throw new ForbiddenException("You do not have permission to revoke consumer sessions");
    }

    let deliveryStatus: "queued" | null = null;
    try {
      if (dto.action === "password_reset") {
        await this.authService.forgotPassword(user.email);
        deliveryStatus = "queued";
      } else if (dto.action === "verification_resend") {
        if (user.emailVerified) throw new ConflictException("Email is already verified");
        await this.authService.sendEmailVerification(user.id, user.email);
        deliveryStatus = "queued";
      }
    } catch (error) {
      if (!(error instanceof ConflictException)) {
        await this.persistRecoveryOperation(userId, dto, actor, context, "failed", "failed");
      }
      throw error;
    }

    await this.persistRecoveryOperation(userId, dto, actor, context, "completed", deliveryStatus);
    return this.getUserOperations(userId, actor);
  }

  private async persistRecoveryOperation(
    userId: string,
    dto: AdminUserRecoveryDto,
    actor: AdminRequestActor | null | undefined,
    context: AdminRequestContext | null | undefined,
    status: "completed" | "failed",
    deliveryStatus: "queued" | "failed" | null,
  ) {
    await this.dataSource.transaction(async (manager) => {
      if (dto.action === "sessions_revoked" && status === "completed") {
        const repository = manager.getRepository(User);
        const current = await repository.findOne({ where: { id: userId } });
        if (!current) throw new NotFoundException("User not found");
        current.sessionVersion = (current.sessionVersion ?? 0) + 1;
        await repository.save(current);
      }
      const repository = manager.getRepository(UserRecoveryOperation);
      const operation = await repository.save(repository.create({
        userId,
        type: dto.action,
        status,
        reason: dto.reason.trim(),
        initiatedByAdminUserId: actor?.id ?? null,
        initiatedByAdminEmail: actor?.email ?? null,
        deliveryStatus,
      }));
      await this.auditLogsService.append({
        action: `admin.users.${dto.action}`,
        actor,
        context,
        targetType: "user",
        targetId: userId,
        metadata: { operationId: operation.id, reason: dto.reason, status, deliveryStatus },
      }, manager);
    });
  }

  private applyUserFilters(
    qb: ReturnType<Repository<User>["createQueryBuilder"]>,
    filters: {
      search?: string;
      status?: string;
      verification?: string;
      restriction?: string;
      includePii?: boolean;
      signupFrom?: Date | null;
      signupToExclusive?: Date | null;
    },
  ) {
    if (filters.search) {
      qb.andWhere(
        filters.includePii
          ? "(user.id::text ILIKE :search OR user.email ILIKE :search OR user.fullName ILIKE :search)"
          : "(user.id::text ILIKE :search OR user.fullName ILIKE :search)",
        { search: `%${filters.search}%` },
      );
    }

    if (filters.status === "active") {
      qb.andWhere("user.isSuspended = false");
    } else if (filters.status === "suspended") {
      qb.andWhere("user.isSuspended = true");
    }

    if (filters.verification === "verified") {
      qb.andWhere("user.emailVerified = true");
    } else if (filters.verification === "unverified") {
      qb.andWhere("user.emailVerified = false");
    }

    if (filters.restriction === "active") {
      qb.andWhere(`EXISTS (
        SELECT 1 FROM user_restrictions active_restriction
        WHERE active_restriction."userId" = "user"."id"
          AND active_restriction.status = 'active'
      )`);
    } else if (filters.restriction === "none") {
      qb.andWhere(`NOT EXISTS (
        SELECT 1 FROM user_restrictions active_restriction
        WHERE active_restriction."userId" = "user"."id"
          AND active_restriction.status = 'active'
      )`);
    }

    if (filters.signupFrom) {
      qb.andWhere("user.createdAt >= :signupFrom", { signupFrom: filters.signupFrom.toISOString() });
    }

    if (filters.signupToExclusive) {
      qb.andWhere("user.createdAt < :signupToExclusive", {
        signupToExclusive: filters.signupToExclusive.toISOString(),
      });
    }
  }

  private applyUserSorting(
    qb: ReturnType<Repository<User>["createQueryBuilder"]>,
    sortBy?: string,
    sortOrder?: string,
    includePii = false,
  ) {
    const order = sortOrder?.toUpperCase() === "ASC" ? "ASC" : "DESC";

    switch (sortBy) {
      case "fullName":
        qb.orderBy("user.fullName", order);
        break;
      case "email":
        qb.orderBy(includePii ? "user.email" : "user.createdAt", order);
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
      isSuspended: user.isSuspended,
      suspensionReason: user.suspensionReason ?? null,
      suspendedAt: user.suspendedAt?.toISOString?.() ?? null,
      lastLoginAt: user.lastLoginAt?.toISOString?.() ?? null,
      emailPresent: Boolean(user.email),
      countryPresent: Boolean(user.country),
    };
  }

  private serializeUserListRow(row: Record<string, unknown>, includePii: boolean) {
    return {
      id: String(row.id),
      fullName: String(row.full_name ?? ""),
      email: includePii ? String(row.email ?? "") : null,
      country: includePii ? String(row.country ?? "") : null,
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at,
      lastActivityAt: row.last_activity_at ?? row.last_login_at ?? row.created_at,
      signupSource: row.signup_source ?? null,
      status: Boolean(row.is_suspended) ? "suspended" : "active",
      emailVerified: Boolean(row.email_verified),
      activeRestrictionCount: Number(row.active_restriction_count ?? 0),
      openCaseCount: Number(row.open_case_count ?? 0),
      repitCount: Number(row.repit_count ?? 0),
      connectedProviders: this.parseTextArray(row.connected_platforms),
      pushTokenPresent: Number(row.push_token_count ?? 0) > 0,
      lastPushTokenAt: row.last_push_token_at ?? null,
    };
  }

  private hasPermission(actor: AdminRequestActor | null | undefined, permission: string) {
    return Boolean(actor?.permissionKeys.includes(permission));
  }

  private async requireUser(userId: string) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");
    return user;
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
