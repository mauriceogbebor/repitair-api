import { ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import * as bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { LessThanOrEqual, MoreThan, Repository } from "typeorm";
import { TokenBlacklistService } from "../../../common/services/token-blacklist.service";
import { AdminBreakGlassGrant, AdminUser } from "../../../entities";
import { ADMIN_PERMISSION_DEFINITIONS } from "../admin.constants";
import { AdminAuditLogsService } from "../audit-logs/admin-audit-logs.service";
import type { AdminRequestActor, AdminRequestContext } from "../admin.types";
import { buildTotpUri, verifyTotpCode } from "../utils/totp";
import { AdminSessionRegistryService } from "../iam/admin-session-registry.service";
import { AdminLoginDto } from "./dto/admin-login.dto";
import { AdminVerifyMfaDto } from "./dto/admin-verify-mfa.dto";
import { AdminMfaTicketStoreService } from "./admin-mfa-ticket-store.service";
import { AdminTokenService } from "./admin-token.service";

@Injectable()
export class AdminAuthService {
  constructor(
    @InjectRepository(AdminUser)
    private readonly adminUserRepository: Repository<AdminUser>,
    @InjectRepository(AdminBreakGlassGrant)
    private readonly breakGlassRepository: Repository<AdminBreakGlassGrant>,
    private readonly configService: ConfigService,
    private readonly tokenService: AdminTokenService,
    private readonly auditLogsService: AdminAuditLogsService,
    private readonly tokenBlacklistService: TokenBlacklistService,
    private readonly sessionRegistry: AdminSessionRegistryService,
    private readonly mfaTicketStore: AdminMfaTicketStoreService,
  ) {}

  async login(dto: AdminLoginDto, context?: AdminRequestContext | null) {
    const adminUser = await this.findByEmailForLogin(dto.email);

    if (!adminUser) {
      await this.auditLogsService.append({
        action: "admin.auth.login.failed",
        context,
        metadata: { email: dto.email, reason: "admin_not_found" },
      });
      throw new UnauthorizedException("Invalid admin email or password");
    }

    this.assertAccountIsUsable(adminUser);

    const validPassword = await bcrypt.compare(dto.password, adminUser.passwordHash);
    if (!validPassword) {
      await this.handleFailedLogin(adminUser, context, "invalid_password");
      throw new UnauthorizedException("Invalid admin email or password");
    }

    if (!adminUser.mfaSecret) {
      await this.auditLogsService.append({
        action: "admin.auth.login.blocked",
        actor: this.toActor(adminUser),
        context,
        metadata: { reason: "mfa_not_configured" },
      });
      throw new ForbiddenException("MFA enrollment is unavailable for this admin account");
    }

    await this.resetFailedLoginState(adminUser);

    return {
      status: adminUser.mfaResetRequired || !adminUser.mfaEnabled ? "MFA_ENROLLMENT_REQUIRED" as const : "MFA_REQUIRED" as const,
      ticket: this.tokenService.signMfaTicket({ sub: adminUser.id, email: adminUser.email }),
      admin: this.serializeAdmin(adminUser),
    };
  }

  async getMfaEnrollment(ticket: string) {
    const ticketPayload = this.tokenService.verifyMfaTicket(ticket);
    const adminUser = await this.findByIdForLogin(ticketPayload.sub);
    if (!adminUser) throw new UnauthorizedException("Admin account not found for MFA enrollment");
    this.assertAccountIsUsable(adminUser);
    if ((!adminUser.mfaResetRequired && adminUser.mfaEnabled) || !adminUser.mfaSecret) throw new ForbiddenException("MFA enrollment is not required for this account");
    return { secret: adminUser.mfaSecret, otpauthUri: buildTotpUri({ secret: adminUser.mfaSecret, email: adminUser.email, issuer: "Repitair Admin" }) };
  }

  async verifyMfa(dto: AdminVerifyMfaDto & { ticket: string }, context?: AdminRequestContext | null) {
    const ticketPayload = this.tokenService.verifyMfaTicket(dto.ticket);
    const adminUser = await this.findByIdForLogin(ticketPayload.sub);

    if (!adminUser) {
      throw new UnauthorizedException("Admin account not found for MFA verification");
    }

    this.assertAccountIsUsable(adminUser);

    if (!adminUser.mfaSecret) {
      throw new ForbiddenException("MFA is not configured for this admin account");
    }

    const isValidCode = verifyTotpCode({ secret: adminUser.mfaSecret, code: dto.code });
    if (!isValidCode) {
      await this.auditLogsService.append({
        action: "admin.auth.mfa.failed",
        actor: this.toActor(adminUser),
        context,
        metadata: { reason: "invalid_totp_code" },
      });
      throw new UnauthorizedException("Invalid MFA code");
    }

    // Consume only after a valid TOTP so a typo does not invalidate the login,
    // while concurrent successful submissions still yield exactly one session.
    await this.mfaTicketStore.consume(ticketPayload);

    adminUser.lastLoginAt = new Date();
    adminUser.lastActivityAt = new Date();
    adminUser.lastLoginIp = context?.ipAddress ?? null;
    adminUser.failedLoginAttempts = 0;
    adminUser.lockedUntil = null;
    adminUser.status = "active";
    if (!adminUser.mfaEnabled || adminUser.mfaResetRequired) {
      adminUser.mfaEnabled = true;
      adminUser.mfaResetRequired = false;
      adminUser.mfaEnrolledAt = new Date();
    }
    await this.adminUserRepository.save(adminUser);

    await this.auditLogsService.append({
      action: "admin.auth.login.succeeded",
      actor: this.toActor(adminUser),
      context,
      metadata: { roleKeys: adminUser.roles.map((role) => role.key) },
    });

    const sessionId = randomUUID();
    const accessToken = this.tokenService.signAccessToken({ sub: adminUser.id, email: adminUser.email, sid: sessionId });
    const tokenPayload = this.tokenService.verifyAccessToken(accessToken);
    await this.sessionRegistry.createSession({
      id: sessionId,
      adminUserId: adminUser.id,
      expiresAt: new Date((tokenPayload.exp ?? 0) * 1000),
      context,
    });

    return {
      status: "ACCESS_GRANTED" as const,
      accessToken,
      admin: this.serializeAdmin(adminUser),
    };
  }

  async getCurrentAdmin(adminId: string) {
    const adminUser = await this.findByIdForAccess(adminId);
    if (!adminUser) {
      throw new UnauthorizedException("Admin account not found");
    }
    const actor = await this.resolveActor(adminId);
    return {
      ...this.serializeAdmin(adminUser),
      permissions: actor?.permissionKeys ?? [],
      breakGlass: actor?.breakGlass ?? null,
    };
  }

  async logout(
    actor: AdminRequestActor,
    accessToken: string,
    expiresAt?: number,
    context?: AdminRequestContext | null,
    sessionId?: string,
  ) {
    await this.tokenBlacklistService.add(accessToken, expiresAt);
    if (sessionId) {
      await this.sessionRegistry.revokeSession(sessionId, actor.id, actor.id, "User initiated logout");
    }
    await this.auditLogsService.append({
      action: "admin.auth.logout",
      actor,
      context,
      metadata: { message: "Admin session revoked" },
    });

    return { success: true };
  }

  async findByIdForAccess(adminId: string): Promise<AdminUser | null> {
    return this.adminUserRepository.findOne({
      where: { id: adminId },
      relations: { roles: { permissions: true } },
    });
  }

  async resolveActor(adminId: string): Promise<AdminRequestActor | null> {
    const adminUser = await this.findByIdForAccess(adminId);
    if (!adminUser) return null;
    const now = new Date();
    const expired = await this.breakGlassRepository.find({ where: { adminUserId: adminId, status: "active", expiresAt: LessThanOrEqual(now) } });
    for (const grant of expired) {
      grant.status = "expired";
      await this.breakGlassRepository.save(grant);
      await this.auditLogsService.append({ action: "admin.iam.break_glass.expired", targetType: "admin_break_glass_grant", targetId: grant.id, afterState: { status: "expired", adminUserId: adminId } });
    }
    const grant = await this.breakGlassRepository.findOne({ where: { adminUserId: adminId, status: "active", expiresAt: MoreThan(now) }, order: { createdAt: "DESC" } });
    const actor = this.toActor(adminUser);
    if (grant) {
      actor.permissionKeys = ADMIN_PERMISSION_DEFINITIONS.map((permission) => permission.key);
      actor.breakGlass = { grantId: grant.id, expiresAt: grant.expiresAt.toISOString() };
    }
    return actor;
  }

  private serializeAdmin(adminUser: AdminUser) {
    const permissionKeys = Array.from(
      new Set(adminUser.roles.flatMap((role) => role.permissions.map((permission) => permission.key))),
    ).sort();

    return {
      id: adminUser.id,
      email: adminUser.email,
      fullName: adminUser.fullName,
      status: adminUser.status,
      mfaEnabled: adminUser.mfaEnabled,
      lastLoginAt: adminUser.lastLoginAt ?? null,
      roleKeys: adminUser.roles.map((role) => role.key),
      roles: adminUser.roles.map((role) => ({
        id: role.id,
        key: role.key,
        name: role.name,
      })),
      permissions: permissionKeys,
    };
  }

  private toActor(adminUser: AdminUser): AdminRequestActor {
    return {
      id: adminUser.id,
      email: adminUser.email,
      fullName: adminUser.fullName,
      status: adminUser.status,
      roleKeys: adminUser.roles.map((role) => role.key),
      permissionKeys: Array.from(
        new Set(adminUser.roles.flatMap((role) => role.permissions.map((permission) => permission.key))),
      ),
    };
  }

  private async findByEmailForLogin(email: string): Promise<AdminUser | null> {
    return this.adminUserRepository
      .createQueryBuilder("adminUser")
      .addSelect(["adminUser.passwordHash", "adminUser.mfaSecret"])
      .leftJoinAndSelect("adminUser.roles", "role")
      .leftJoinAndSelect("role.permissions", "permission")
      .where("LOWER(adminUser.email) = LOWER(:email)", { email })
      .getOne();
  }

  private async findByIdForLogin(id: string): Promise<AdminUser | null> {
    return this.adminUserRepository
      .createQueryBuilder("adminUser")
      .addSelect(["adminUser.passwordHash", "adminUser.mfaSecret"])
      .leftJoinAndSelect("adminUser.roles", "role")
      .leftJoinAndSelect("role.permissions", "permission")
      .where("adminUser.id = :id", { id })
      .getOne();
  }

  private assertAccountIsUsable(adminUser: AdminUser): void {
    if (["disabled", "inactive"].includes(adminUser.status)) throw new ForbiddenException("This admin account is inactive");
    if (adminUser.status === "suspended") throw new ForbiddenException("This admin account has been suspended");
    if (adminUser.status === "pending_invitation") throw new ForbiddenException("Accept the administrator invitation before signing in");

    if (adminUser.lockedUntil && adminUser.lockedUntil.getTime() > Date.now()) {
      throw new ForbiddenException("This admin account is temporarily locked");
    }
  }

  private async handleFailedLogin(
    adminUser: AdminUser,
    context: AdminRequestContext | null | undefined,
    reason: string,
  ): Promise<void> {
    const maxAttempts = Number.parseInt(
      this.configService.get<string>("ADMIN_LOGIN_MAX_ATTEMPTS") ?? "5",
      10,
    );
    const lockMinutes = Number.parseInt(
      this.configService.get<string>("ADMIN_LOGIN_LOCK_MINUTES") ?? "15",
      10,
    );

    adminUser.failedLoginAttempts += 1;

    if (adminUser.failedLoginAttempts >= maxAttempts) {
      adminUser.lockedUntil = new Date(Date.now() + lockMinutes * 60_000);
      adminUser.status = "locked";
    }

    await this.adminUserRepository.save(adminUser);
    await this.auditLogsService.append({
      action: "admin.auth.login.failed",
      actor: this.toActor(adminUser),
      context,
      metadata: {
        reason,
        failedLoginAttempts: adminUser.failedLoginAttempts,
        lockedUntil: adminUser.lockedUntil?.toISOString() ?? null,
      },
    });
  }

  private async resetFailedLoginState(adminUser: AdminUser): Promise<void> {
    if (
      adminUser.failedLoginAttempts === 0 &&
      !adminUser.lockedUntil &&
      adminUser.status === "active"
    ) {
      return;
    }

    adminUser.failedLoginAttempts = 0;
    adminUser.lockedUntil = null;
    if (adminUser.status === "locked") {
      adminUser.status = "active";
    }
    await this.adminUserRepository.save(adminUser);
  }
}
