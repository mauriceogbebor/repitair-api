import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import * as bcrypt from "bcryptjs";
import { createHash, randomBytes } from "crypto";
import { In, LessThanOrEqual, MoreThan, Repository } from "typeorm";
import { MailService } from "../../../common/services/mail.service";
import { renderBrandedEmail } from "../../../common/services/email-template";
import {
  AdminAccessReview,
  AdminAuditLog,
  AdminBreakGlassGrant,
  AdminInvitation,
  AdminPermission,
  AdminRole,
  AdminUser,
} from "../../../entities";
import { ADMIN_PERMISSION_DEFINITIONS } from "../admin.constants";
import type { AdminRequestActor, AdminRequestContext } from "../admin.types";
import { AdminAuditLogsService } from "../audit-logs/admin-audit-logs.service";
import { buildTotpUri, generateTotpSecret, verifyTotpCode } from "../utils/totp";
import { AdminAccessReviewDto } from "./dto/admin-access-review.dto";
import { AdminAcceptInvitationDto, AdminCompleteInvitationMfaDto } from "./dto/admin-accept-invitation.dto";
import { AdminBreakGlassDto } from "./dto/admin-break-glass.dto";
import { AdminInviteAdminDto } from "./dto/admin-invite-admin.dto";
import { AdminListAdminsQueryDto } from "./dto/admin-list-admins-query.dto";
import { AdminSessionRegistryService } from "./admin-session-registry.service";

const INVITATION_TTL_HOURS = 72;
const DEFAULT_REVIEW_DAYS = 90;

@Injectable()
export class AdminIamService {
  private readonly logger = new Logger(AdminIamService.name);

  constructor(
    @InjectRepository(AdminUser) private readonly adminUsers: Repository<AdminUser>,
    @InjectRepository(AdminRole) private readonly roles: Repository<AdminRole>,
    @InjectRepository(AdminPermission) private readonly permissions: Repository<AdminPermission>,
    @InjectRepository(AdminInvitation) private readonly invitations: Repository<AdminInvitation>,
    @InjectRepository(AdminAccessReview) private readonly reviews: Repository<AdminAccessReview>,
    @InjectRepository(AdminBreakGlassGrant) private readonly breakGlassGrants: Repository<AdminBreakGlassGrant>,
    @InjectRepository(AdminAuditLog) private readonly auditLogs: Repository<AdminAuditLog>,
    private readonly sessions: AdminSessionRegistryService,
    private readonly audit: AdminAuditLogsService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  async listAdmins(query: AdminListAdminsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const sortBy = query.sortBy ?? "createdAt";
    const qb = this.adminUsers.createQueryBuilder("admin")
      .leftJoinAndSelect("admin.roles", "role")
      .leftJoinAndSelect("role.permissions", "permission")
      .distinct(true);

    if (query.search?.trim()) {
      qb.andWhere("(admin.fullName ILIKE :search OR admin.email ILIKE :search)", { search: `%${query.search.trim()}%` });
    }
    if (query.status) qb.andWhere("admin.status = :status", { status: query.status });
    if (query.roleId) qb.andWhere("role.id = :roleId", { roleId: query.roleId });
    if (query.mfa === "enabled") qb.andWhere("admin.mfaEnabled = true AND admin.mfaResetRequired = false");
    if (query.mfa === "disabled") qb.andWhere("admin.mfaEnabled = false AND admin.mfaResetRequired = false");
    if (query.mfa === "reset_required") qb.andWhere("admin.mfaResetRequired = true");
    if (query.review === "due") qb.andWhere("admin.accessReviewDueAt <= :now", { now: new Date() });
    if (query.review === "current") qb.andWhere("(admin.accessReviewDueAt IS NULL OR admin.accessReviewDueAt > :now)", { now: new Date() });

    qb.orderBy(`admin.${sortBy}`, query.sortOrder === "asc" ? "ASC" : "DESC")
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [records, total] = await qb.getManyAndCount();
    return { total, page, pageSize, records: records.map((admin) => this.directoryItem(admin)) };
  }

  async listRoles() {
    const roles = await this.roles.find({ order: { name: "ASC" } });
    return roles.map((role) => ({
      id: role.id,
      key: role.key,
      name: role.name,
      description: role.description ?? null,
      isSystem: role.isSystem,
      permissions: role.permissions.map((permission) => this.permissionItem(permission)),
    }));
  }

  async getAdminDetail(adminId: string, currentSessionId?: string) {
    await this.expireBreakGlassGrants();
    const admin = await this.requireAdmin(adminId);
    const [sessions, reviews, activity, loginHistory, activeGrant, invitation] = await Promise.all([
      this.sessions.listForAdmin(adminId),
      this.reviews.find({ where: { adminUserId: adminId }, order: { createdAt: "DESC" }, take: 20 }),
      this.auditLogs.find({ where: { actorAdminUserId: adminId }, order: { createdAt: "DESC" }, take: 25 }),
      this.auditLogs.find({ where: { actorAdminUserId: adminId, action: "admin.auth.login.succeeded" }, order: { createdAt: "DESC" }, take: 20 }),
      this.breakGlassGrants.findOne({ where: { adminUserId: adminId, status: "active", expiresAt: MoreThan(new Date()) }, order: { createdAt: "DESC" } }),
      this.invitations.findOne({ where: { adminUserId: adminId }, order: { createdAt: "DESC" } }),
    ]);
    const effectivePermissions = this.effectivePermissions(admin.roles);

    return {
      profile: this.directoryItem(admin),
      roles: admin.roles.map((role) => ({ id: role.id, key: role.key, name: role.name, description: role.description ?? null })),
      effectivePermissions: this.groupPermissions(effectivePermissions),
      loginHistory: loginHistory.map((event) => this.auditItem(event)),
      recentActivity: activity.map((event) => this.auditItem(event)),
      sessions: sessions.map((session) => ({
        id: session.id,
        browser: session.browser ?? "Unknown browser",
        operatingSystem: session.operatingSystem ?? "Unknown OS",
        approximateLocation: session.approximateLocation ?? null,
        ipAddress: this.maskIp(session.ipAddress),
        createdAt: session.createdAt,
        lastActivityAt: session.lastActivityAt ?? null,
        expiresAt: session.expiresAt,
        revokedAt: session.revokedAt ?? null,
        current: session.id === currentSessionId,
      })),
      security: {
        mfaEnabled: admin.mfaEnabled,
        mfaEnrolledAt: admin.mfaEnrolledAt ?? null,
        mfaResetRequired: admin.mfaResetRequired,
        failedLoginAttempts: admin.failedLoginAttempts,
        lockedUntil: admin.lockedUntil ?? null,
      },
      accessReview: {
        dueAt: admin.accessReviewDueAt ?? null,
        lastReviewedAt: admin.lastAccessReviewedAt ?? null,
        history: reviews,
      },
      breakGlass: activeGrant ? { id: activeGrant.id, reason: activeGrant.reason, expiresAt: activeGrant.expiresAt, activatedAt: activeGrant.createdAt } : null,
      invitation: invitation ? { status: invitation.status, expiresAt: invitation.expiresAt, acceptedAt: invitation.acceptedAt ?? null } : null,
    };
  }

  async invite(dto: AdminInviteAdminDto, actor: AdminRequestActor, context?: AdminRequestContext | null) {
    const email = dto.email.trim().toLowerCase();
    if (await this.adminUsers.findOne({ where: { email } })) throw new ConflictException("An administrator with this email already exists");
    const roles = await this.resolveRoles(dto.roleIds);
    this.assertActorControlsPermissions(actor, roles.flatMap((role) => role.permissions.map((permission) => permission.key)));

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + INVITATION_TTL_HOURS * 60 * 60_000);
    const admin = await this.adminUsers.save(this.adminUsers.create({
      fullName: dto.fullName.trim(),
      email,
      passwordHash: await bcrypt.hash(randomBytes(48).toString("base64url"), 12),
      status: "pending_invitation",
      mfaEnabled: false,
      mfaResetRequired: true,
      roles,
      accessReviewDueAt: this.daysFromNow(DEFAULT_REVIEW_DAYS),
    }));
    const invitation = await this.invitations.save(this.invitations.create({
      adminUserId: admin.id,
      tokenHash: this.hashToken(token),
      status: "pending",
      invitedByAdminUserId: actor.id,
      expiresAt,
    }));

    const origin = this.config.get<string>("ADMIN_FRONTEND_ORIGIN");
    if (!origin) throw new BadRequestException("ADMIN_FRONTEND_ORIGIN is required to send invitations");
    const acceptUrl = `${origin}/accept-invite?token=${token}`;
    // Email delivery is best-effort: a failure keeps the invitation usable and
    // returns the one-time link so the inviter can share it (see the helper).
    const emailDelivered = await this.tryEmailInvitation(email, admin.fullName, acceptUrl);

    await this.audit.append({ action: "admin.iam.invited", actor, context, targetType: "admin_user", targetId: admin.id, afterState: this.auditAdminState(admin), metadata: { roleIds: roles.map((role) => role.id), expiresAt: expiresAt.toISOString(), emailDelivered } });
    return {
      id: admin.id,
      email: admin.email,
      status: admin.status,
      invitationExpiresAt: expiresAt,
      emailDelivered,
      // Only surface the token-bearing link when email delivery failed — a
      // fallback channel for the trusted inviter. When email succeeds the
      // invitee already has it, so we never expose the token needlessly.
      acceptUrl: emailDelivered ? null : acceptUrl,
    };
  }

  /**
   * Regenerate and re-send the invitation for an administrator who has not yet
   * accepted (pending / MFA-enrolling, or deactivated by an earlier failed
   * invite). Mints a fresh token, revives the pending state, and returns the
   * one-time link when email cannot be delivered — so an admin stuck on email
   * delivery can still be onboarded without touching the database.
   */
  async resendInvitation(adminId: string, actor: AdminRequestActor, context?: AdminRequestContext | null) {
    const admin = await this.requireAdmin(adminId);
    const invitation = await this.invitations.findOne({ where: { adminUserId: adminId }, order: { createdAt: "DESC" } });
    if (!invitation || invitation.status === "accepted") {
      throw new ConflictException("This administrator has already accepted an invitation, so there is nothing to resend.");
    }

    const origin = this.config.get<string>("ADMIN_FRONTEND_ORIGIN");
    if (!origin) throw new BadRequestException("ADMIN_FRONTEND_ORIGIN is required to send invitations");

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + INVITATION_TTL_HOURS * 60 * 60_000);
    invitation.tokenHash = this.hashToken(token);
    invitation.status = "pending";
    invitation.expiresAt = expiresAt;
    invitation.acceptedAt = null;
    invitation.revokedAt = null;
    await this.invitations.save(invitation);

    if (admin.status !== "pending_invitation") {
      admin.status = "pending_invitation";
      admin.inactiveAt = null;
      admin.mfaResetRequired = true;
      await this.adminUsers.save(admin);
    }

    const acceptUrl = `${origin}/accept-invite?token=${token}`;
    const emailDelivered = await this.tryEmailInvitation(admin.email, admin.fullName, acceptUrl);
    await this.audit.append({ action: "admin.iam.invitation.resent", actor, context, targetType: "admin_user", targetId: admin.id, afterState: this.auditAdminState(admin), metadata: { expiresAt: expiresAt.toISOString(), emailDelivered } });
    return {
      id: admin.id,
      email: admin.email,
      status: admin.status,
      invitationExpiresAt: expiresAt,
      emailDelivered,
      acceptUrl: emailDelivered ? null : acceptUrl,
    };
  }

  /** Best-effort invitation email; returns false (and logs the cause) on failure. */
  private async tryEmailInvitation(email: string, fullName: string, acceptUrl: string): Promise<boolean> {
    try {
      await this.mail.sendRaw({
        to: email,
        subject: "You're invited to Repitair Admin",
        html: this.buildInvitationEmail(fullName, acceptUrl),
        sensitive: true,
      });
      return true;
    } catch (error) {
      this.logger.error(`Failed to email admin invitation to ${email}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /** Branded, email-client-safe invitation HTML (shared Repitair email shell). */
  private buildInvitationEmail(fullName: string, acceptUrl: string): string {
    const name = fullName?.trim() || "there";
    return renderBrandedEmail({
      preheader: `Accept your invitation to Repitair Admin. This secure link expires in ${INVITATION_TTL_HOURS} hours.`,
      heading: "You've been invited",
      intro: `Hi ${name}, you've been invited to the Repitair Admin console. Set your password and enroll multi-factor authentication to activate your account.`,
      cta: { label: "Accept invitation", url: acceptUrl },
      fallbackUrl: acceptUrl,
      note: `This secure link expires in ${INVITATION_TTL_HOURS} hours and can be used once. If you weren't expecting this invitation, you can safely ignore this email — no account is created until you accept.`,
    });
  }

  async getInvitation(token: string) {
    const { invitation, admin } = await this.requireInvitation(token, ["pending", "enrolling_mfa"]);
    return { email: admin.email, fullName: admin.fullName, roles: admin.roles.map((role) => role.name), status: invitation.status, expiresAt: invitation.expiresAt };
  }

  async acceptInvitationPassword(token: string, dto: AdminAcceptInvitationDto, context?: AdminRequestContext | null) {
    const { invitation, admin } = await this.requireInvitation(token, ["pending", "enrolling_mfa"]);
    admin.passwordHash = await bcrypt.hash(dto.password, 12);
    admin.mfaSecret = generateTotpSecret();
    admin.mfaEnabled = false;
    admin.mfaResetRequired = true;
    invitation.status = "enrolling_mfa";
    await Promise.all([this.adminUsers.save(admin), this.invitations.save(invitation)]);
    await this.audit.append({ action: "admin.iam.invitation.password_created", context, targetType: "admin_user", targetId: admin.id });
    return { secret: admin.mfaSecret, otpauthUri: buildTotpUri({ secret: admin.mfaSecret, email: admin.email, issuer: "Repitair Admin" }) };
  }

  async completeInvitationMfa(token: string, dto: AdminCompleteInvitationMfaDto, context?: AdminRequestContext | null) {
    const { invitation, admin } = await this.requireInvitation(token, ["enrolling_mfa"]);
    if (!admin.mfaSecret || !verifyTotpCode({ secret: admin.mfaSecret, code: dto.code })) throw new BadRequestException("Invalid MFA code");
    const now = new Date();
    admin.mfaEnabled = true;
    admin.mfaResetRequired = false;
    admin.mfaEnrolledAt = now;
    admin.status = "active";
    invitation.status = "accepted";
    invitation.acceptedAt = now;
    await Promise.all([this.adminUsers.save(admin), this.invitations.save(invitation)]);
    await this.audit.append({ action: "admin.iam.invitation.accepted", context, targetType: "admin_user", targetId: admin.id, afterState: this.auditAdminState(admin) });
    return { success: true };
  }

  async revokeInvitation(adminId: string, reason: string, actor: AdminRequestActor, context?: AdminRequestContext | null) {
    const admin = await this.requireAdmin(adminId);
    const invitation = await this.invitations.findOne({ where: { adminUserId: adminId }, order: { createdAt: "DESC" } });
    if (!invitation || !["pending", "enrolling_mfa"].includes(invitation.status)) throw new ConflictException("There is no active invitation to revoke");
    invitation.status = "revoked";
    invitation.revokedAt = new Date();
    admin.status = "inactive";
    admin.inactiveAt = new Date();
    await Promise.all([this.invitations.save(invitation), this.adminUsers.save(admin)]);
    await this.audit.append({ action: "admin.iam.invitation.revoked", actor, context, targetType: "admin_user", targetId: admin.id, afterState: this.auditAdminState(admin), metadata: { invitationId: invitation.id, reason } });
    return { success: true };
  }

  async updateRoles(adminId: string, roleIds: string[], actor: AdminRequestActor, context?: AdminRequestContext | null) {
    const admin = await this.requireAdmin(adminId);
    const nextRoles = await this.resolveRoles(roleIds);
    const previousRoles = [...admin.roles];
    const before = this.auditAdminState(admin);
    const beforeKeys = new Set(this.effectivePermissions(admin.roles).map((permission) => permission.key));
    const afterKeys = new Set(this.effectivePermissions(nextRoles).map((permission) => permission.key));
    const changedKeys = [...new Set([...beforeKeys, ...afterKeys])].filter((key) => beforeKeys.has(key) !== afterKeys.has(key));
    this.assertActorControlsPermissions(actor, changedKeys);
    if (admin.id === actor.id && (!afterKeys.has("admins.manage") || !afterKeys.has("roles.manage"))) throw new ForbiddenException("You cannot remove your own IAM administration access");
    await this.assertSuperAdminContinuity(admin, nextRoles);
    admin.roles = nextRoles;
    await this.adminUsers.save(admin);
    await this.audit.append({ action: "admin.iam.roles.updated", actor, context, targetType: "admin_user", targetId: admin.id, beforeState: before, afterState: this.auditAdminState(admin), metadata: { changedPermissions: changedKeys } });
    const previousRoleIds = new Set(previousRoles.map((role) => role.id));
    const nextRoleIds = new Set(nextRoles.map((role) => role.id));
    for (const role of previousRoles.filter((role) => !nextRoleIds.has(role.id))) {
      await this.audit.append({ action: "admin.iam.role.removed", actor, context, targetType: "admin_user", targetId: admin.id, metadata: { roleId: role.id, roleKey: role.key } });
    }
    for (const role of nextRoles.filter((role) => !previousRoleIds.has(role.id))) {
      await this.audit.append({ action: "admin.iam.role.assigned", actor, context, targetType: "admin_user", targetId: admin.id, metadata: { roleId: role.id, roleKey: role.key } });
    }
    return this.getAdminDetail(admin.id);
  }

  async revokeSession(adminId: string, sessionId: string, reason: string, actor: AdminRequestActor, context?: AdminRequestContext | null) {
    await this.requireAdmin(adminId);
    await this.sessions.revokeSession(sessionId, adminId, actor.id, reason);
    await this.audit.append({ action: "admin.iam.session.revoked", actor, context, targetType: "admin_session", targetId: sessionId, metadata: { adminUserId: adminId, reason } });
    return { success: true };
  }

  async revokeOtherSessions(adminId: string, currentSessionId: string | undefined, reason: string, actor: AdminRequestActor, context?: AdminRequestContext | null) {
    await this.requireAdmin(adminId);
    const count = await this.sessions.revokeOthers(adminId, currentSessionId, actor.id, reason);
    await this.audit.append({ action: "admin.iam.sessions.revoked", actor, context, targetType: "admin_user", targetId: adminId, metadata: { count, reason, excludedCurrentSession: currentSessionId ?? null } });
    return { success: true, count };
  }

  async resetMfa(adminId: string, disable: boolean, reason: string, actor: AdminRequestActor, context?: AdminRequestContext | null) {
    const admin = await this.requireAdmin(adminId);
    const before = this.auditAdminState(admin);
    admin.mfaSecret = disable ? null : generateTotpSecret();
    admin.mfaEnabled = false;
    admin.mfaResetRequired = !disable;
    admin.mfaEnrolledAt = null;
    await this.adminUsers.save(admin);
    await this.sessions.revokeAll(admin.id, actor.id, disable ? "MFA disabled" : "MFA reset");
    await this.audit.append({ action: disable ? "admin.iam.mfa.disabled" : "admin.iam.mfa.reset", actor, context, targetType: "admin_user", targetId: admin.id, beforeState: before, afterState: this.auditAdminState(admin), metadata: { reason } });
    return { success: true };
  }

  async setStatus(adminId: string, status: "active" | "suspended" | "inactive", reason: string, actor: AdminRequestActor, context?: AdminRequestContext | null) {
    const admin = await this.requireAdmin(adminId);
    if (admin.id === actor.id && status !== "active") throw new ForbiddenException("You cannot suspend or deactivate your own account");
    // Mirror the role-change continuity guard: never leave the platform with zero
    // active super administrators by suspending/deactivating the last one.
    if (status !== "active" && admin.roles.some((role) => role.key === "super-admin") && (await this.countActiveSuperAdmins()) <= 1) {
      throw new ForbiddenException("The last active super administrator cannot be suspended or deactivated");
    }
    const before = this.auditAdminState(admin);
    admin.status = status;
    admin.suspendedAt = status === "suspended" ? new Date() : null;
    admin.suspensionReason = status === "suspended" ? reason : null;
    admin.inactiveAt = status === "inactive" ? new Date() : null;
    await this.adminUsers.save(admin);
    if (status !== "active") await this.sessions.revokeAll(admin.id, actor.id, reason);
    await this.audit.append({ action: status === "active" ? "admin.iam.reactivated" : status === "suspended" ? "admin.iam.suspended" : "admin.iam.deactivated", actor, context, targetType: "admin_user", targetId: admin.id, beforeState: before, afterState: this.auditAdminState(admin), metadata: { reason } });
    return this.getAdminDetail(admin.id);
  }

  async completeAccessReview(adminId: string, dto: AdminAccessReviewDto, actor: AdminRequestActor, context?: AdminRequestContext | null) {
    const admin = await this.requireAdmin(adminId);
    const dueAt = admin.accessReviewDueAt ?? new Date();
    const nextReviewAt = dto.nextReviewAt ? new Date(dto.nextReviewAt) : this.daysFromNow(dto.outcome === "postponed" ? 30 : DEFAULT_REVIEW_DAYS);
    if (nextReviewAt.getTime() <= Date.now()) throw new BadRequestException("The next review date must be in the future");
    const review = await this.reviews.save(this.reviews.create({ adminUserId: admin.id, reviewerAdminUserId: actor.id, outcome: dto.outcome, rationale: dto.rationale.trim(), dueAt, nextReviewAt }));
    admin.lastAccessReviewedAt = new Date();
    admin.accessReviewDueAt = nextReviewAt;
    if (dto.outcome === "revoked") {
      admin.status = "suspended";
      admin.suspendedAt = new Date();
      admin.suspensionReason = `Access review: ${dto.rationale.trim()}`;
      await this.sessions.revokeAll(admin.id, actor.id, "Access review revoked access");
    }
    await this.adminUsers.save(admin);
    await this.audit.append({ action: "admin.iam.access_review.completed", actor, context, targetType: "admin_user", targetId: admin.id, afterState: { outcome: review.outcome, nextReviewAt: review.nextReviewAt?.toISOString() ?? null, status: admin.status }, metadata: { rationale: dto.rationale } });
    return this.getAdminDetail(admin.id);
  }

  async activateBreakGlass(adminId: string, dto: AdminBreakGlassDto, actor: AdminRequestActor, context?: AdminRequestContext | null) {
    if (adminId !== actor.id) throw new ForbiddenException("Emergency access can only be activated for the current administrator");
    await this.requireAdmin(adminId);
    await this.expireBreakGlassGrants();
    if (await this.breakGlassGrants.findOne({ where: { adminUserId: adminId, status: "active", expiresAt: MoreThan(new Date()) } })) throw new ConflictException("Emergency access is already active");
    const grant = await this.breakGlassGrants.save(this.breakGlassGrants.create({ adminUserId: adminId, activatedByAdminUserId: actor.id, approvedByAdminUserId: actor.id, reason: dto.reason.trim(), status: "active", expiresAt: new Date(Date.now() + dto.durationMinutes * 60_000) }));
    await this.audit.append({ action: "admin.iam.break_glass.activated", actor, context, targetType: "admin_break_glass_grant", targetId: grant.id, afterState: { expiresAt: grant.expiresAt.toISOString(), adminUserId: adminId }, metadata: { reason: grant.reason, durationMinutes: dto.durationMinutes } });
    return { id: grant.id, expiresAt: grant.expiresAt };
  }

  async revokeBreakGlass(adminId: string, grantId: string, actor: AdminRequestActor, context?: AdminRequestContext | null) {
    const grant = await this.breakGlassGrants.findOne({ where: { id: grantId, adminUserId: adminId } });
    if (!grant) throw new NotFoundException("Emergency access grant not found");
    grant.status = "revoked";
    grant.revokedAt = new Date();
    await this.breakGlassGrants.save(grant);
    await this.audit.append({ action: "admin.iam.break_glass.revoked", actor, context, targetType: "admin_break_glass_grant", targetId: grant.id, afterState: { status: grant.status, revokedAt: grant.revokedAt.toISOString() } });
    return { success: true };
  }

  async expireBreakGlassGrants() {
    const expired = await this.breakGlassGrants.find({ where: { status: "active", expiresAt: LessThanOrEqual(new Date()) } });
    for (const grant of expired) {
      grant.status = "expired";
      await this.breakGlassGrants.save(grant);
      await this.audit.append({ action: "admin.iam.break_glass.expired", targetType: "admin_break_glass_grant", targetId: grant.id, afterState: { status: "expired", adminUserId: grant.adminUserId } });
    }
  }

  private async requireAdmin(adminId: string) {
    const admin = await this.adminUsers.findOne({ where: { id: adminId }, relations: { roles: { permissions: true } } });
    if (!admin) throw new NotFoundException("Administrator not found");
    return admin;
  }

  private async resolveRoles(roleIds: string[]) {
    const uniqueIds = [...new Set(roleIds)];
    const roles = await this.roles.find({ where: { id: In(uniqueIds) } });
    if (roles.length !== uniqueIds.length) throw new BadRequestException("One or more roles do not exist");
    return roles;
  }

  private async requireInvitation(token: string, allowedStatuses: Array<AdminInvitation["status"]>) {
    const invitation = await this.invitations.findOne({ where: { tokenHash: this.hashToken(token) } });
    if (!invitation) throw new NotFoundException("Invitation not found");
    if (invitation.expiresAt.getTime() <= Date.now()) {
      if (invitation.status !== "accepted" && invitation.status !== "revoked") { invitation.status = "expired"; await this.invitations.save(invitation); }
      throw new GoneException("This invitation has expired");
    }
    if (!allowedStatuses.includes(invitation.status)) throw new GoneException(invitation.status === "revoked" ? "This invitation has been revoked" : "This invitation can no longer be used");
    const admin = await this.adminUsers.createQueryBuilder("admin").addSelect(["admin.passwordHash", "admin.mfaSecret"]).leftJoinAndSelect("admin.roles", "role").leftJoinAndSelect("role.permissions", "permission").where("admin.id = :id", { id: invitation.adminUserId }).getOne();
    if (!admin) throw new NotFoundException("Invited administrator not found");
    return { invitation, admin };
  }

  private assertActorControlsPermissions(actor: AdminRequestActor, permissionKeys: string[]) {
    const controlled = new Set(actor.permissionKeys);
    const uncontrolled = [...new Set(permissionKeys)].filter((key) => !controlled.has(key));
    if (uncontrolled.length) throw new ForbiddenException("You cannot assign or remove permissions you do not hold");
  }

  private countActiveSuperAdmins(): Promise<number> {
    return this.adminUsers
      .createQueryBuilder("admin")
      .innerJoin("admin.roles", "role", "role.key = :role", { role: "super-admin" })
      .where("admin.status = :status", { status: "active" })
      .getCount();
  }

  private async assertSuperAdminContinuity(admin: AdminUser, nextRoles: AdminRole[]) {
    if (!admin.roles.some((role) => role.key === "super-admin") || nextRoles.some((role) => role.key === "super-admin")) return;
    if ((await this.countActiveSuperAdmins()) <= 1) throw new ForbiddenException("The last active super administrator cannot lose the super-admin role");
  }

  private directoryItem(admin: AdminUser) {
    return { id: admin.id, fullName: admin.fullName, email: admin.email, status: admin.status, roles: admin.roles.map((role) => ({ id: role.id, key: role.key, name: role.name })), mfa: { enabled: admin.mfaEnabled, enrolledAt: admin.mfaEnrolledAt ?? null, resetRequired: admin.mfaResetRequired }, lastLoginAt: admin.lastLoginAt ?? null, lastActivityAt: admin.lastActivityAt ?? null, accessReviewDueAt: admin.accessReviewDueAt ?? null, createdAt: admin.createdAt, updatedAt: admin.updatedAt };
  }

  private effectivePermissions(roles: AdminRole[]) { return [...new Map(roles.flatMap((role) => role.permissions).map((permission) => [permission.key, permission])).values()].sort((a, b) => a.key.localeCompare(b.key)); }
  private groupPermissions(permissions: AdminPermission[]) {
    const groups = permissions.reduce<Record<string, AdminPermission[]>>((result, permission) => {
      (result[permission.module] ??= []).push(permission);
      return result;
    }, {});
    return Object.entries(groups).map(([module, items]) => ({ module, permissions: items.map((permission) => this.permissionItem(permission)) }));
  }
  private permissionItem(permission: AdminPermission) { return { id: permission.id, key: permission.key, module: permission.module, description: permission.description }; }
  private auditItem(event: AdminAuditLog) { return { id: event.id, action: event.action, targetType: event.targetType ?? null, targetId: event.targetId ?? null, createdAt: event.createdAt }; }
  private auditAdminState(admin: AdminUser) { return { id: admin.id, email: admin.email, status: admin.status, roleKeys: admin.roles.map((role) => role.key), mfaEnabled: admin.mfaEnabled, mfaResetRequired: admin.mfaResetRequired }; }
  private hashToken(token: string) { return createHash("sha256").update(token).digest("hex"); }
  private daysFromNow(days: number) { return new Date(Date.now() + days * 24 * 60 * 60_000); }
  private maskIp(value?: string | null) { if (!value) return null; if (value.includes(":")) return `${value.split(":").slice(0, 4).join(":")}::/64`; const parts = value.split("."); return parts.length === 4 ? `${parts[0]}.${parts[1]}.x.x` : "redacted"; }
  private escapeHtml(value: string) { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;"); }
}
