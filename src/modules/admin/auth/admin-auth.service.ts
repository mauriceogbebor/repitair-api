import { ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import * as bcrypt from "bcryptjs";
import { Repository } from "typeorm";
import { AdminUser } from "../../../entities";
import { AdminAuditLogsService } from "../audit-logs/admin-audit-logs.service";
import type { AdminRequestActor, AdminRequestContext } from "../admin.types";
import { verifyTotpCode } from "../utils/totp";
import { AdminLoginDto } from "./dto/admin-login.dto";
import { AdminVerifyMfaDto } from "./dto/admin-verify-mfa.dto";
import { AdminTokenService } from "./admin-token.service";

@Injectable()
export class AdminAuthService {
  constructor(
    @InjectRepository(AdminUser)
    private readonly adminUserRepository: Repository<AdminUser>,
    private readonly configService: ConfigService,
    private readonly tokenService: AdminTokenService,
    private readonly auditLogsService: AdminAuditLogsService,
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

    if (!adminUser.mfaEnabled || !adminUser.mfaSecret) {
      await this.auditLogsService.append({
        action: "admin.auth.login.blocked",
        actor: this.toActor(adminUser),
        context,
        metadata: { reason: "mfa_not_configured" },
      });
      throw new ForbiddenException("MFA must be configured for this admin account");
    }

    await this.resetFailedLoginState(adminUser);

    return {
      status: "MFA_REQUIRED" as const,
      ticket: this.tokenService.signMfaTicket({ sub: adminUser.id, email: adminUser.email }),
      admin: this.serializeAdmin(adminUser),
    };
  }

  async verifyMfa(dto: AdminVerifyMfaDto, context?: AdminRequestContext | null) {
    const ticketPayload = this.tokenService.verifyMfaTicket(dto.ticket);
    const adminUser = await this.findByIdForLogin(ticketPayload.sub);

    if (!adminUser) {
      throw new UnauthorizedException("Admin account not found for MFA verification");
    }

    this.assertAccountIsUsable(adminUser);

    if (!adminUser.mfaEnabled || !adminUser.mfaSecret) {
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

    adminUser.lastLoginAt = new Date();
    adminUser.lastLoginIp = context?.ipAddress ?? null;
    adminUser.failedLoginAttempts = 0;
    adminUser.lockedUntil = null;
    adminUser.status = "active";
    await this.adminUserRepository.save(adminUser);

    await this.auditLogsService.append({
      action: "admin.auth.login.succeeded",
      actor: this.toActor(adminUser),
      context,
      metadata: { roleKeys: adminUser.roles.map((role) => role.key) },
    });

    return {
      status: "ACCESS_GRANTED" as const,
      accessToken: this.tokenService.signAccessToken({ sub: adminUser.id, email: adminUser.email }),
      admin: this.serializeAdmin(adminUser),
    };
  }

  async getCurrentAdmin(adminId: string) {
    const adminUser = await this.findByIdForAccess(adminId);
    if (!adminUser) {
      throw new UnauthorizedException("Admin account not found");
    }

    return this.serializeAdmin(adminUser);
  }

  async logout(actor: AdminRequestActor, context?: AdminRequestContext | null) {
    await this.auditLogsService.append({
      action: "admin.auth.logout",
      actor,
      context,
      metadata: { message: "Admin logout recorded" },
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
    return adminUser ? this.toActor(adminUser) : null;
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
    if (adminUser.status === "disabled") {
      throw new ForbiddenException("This admin account has been disabled");
    }

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
