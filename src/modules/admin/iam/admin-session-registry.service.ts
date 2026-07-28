import { Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AdminSession, AdminUser } from "../../../entities";
import type { AdminRequestContext } from "../admin.types";

function parseDevice(userAgent?: string | null) {
  const value = userAgent ?? "";
  const browser = /Edg\//.test(value) ? "Edge" : /Chrome\//.test(value) ? "Chrome" : /Firefox\//.test(value) ? "Firefox" : /Safari\//.test(value) ? "Safari" : "Unknown browser";
  const operatingSystem = /Windows/.test(value) ? "Windows" : /Android/.test(value) ? "Android" : /iPhone|iPad/.test(value) ? "iOS" : /Mac OS X/.test(value) ? "macOS" : /Linux/.test(value) ? "Linux" : "Unknown OS";
  return { browser, operatingSystem };
}

@Injectable()
export class AdminSessionRegistryService {
  constructor(
    @InjectRepository(AdminSession) private readonly sessionRepository: Repository<AdminSession>,
    @InjectRepository(AdminUser) private readonly adminUserRepository: Repository<AdminUser>,
  ) {}

  async createSession(options: { id: string; adminUserId: string; expiresAt: Date; context?: AdminRequestContext | null }) {
    const device = parseDevice(options.context?.userAgent);
    return this.sessionRepository.save(this.sessionRepository.create({
      id: options.id,
      adminUserId: options.adminUserId,
      expiresAt: options.expiresAt,
      ipAddress: options.context?.ipAddress ?? null,
      userAgent: options.context?.userAgent ?? null,
      browser: device.browser,
      operatingSystem: device.operatingSystem,
      approximateLocation: null,
      lastActivityAt: new Date(),
    }));
  }

  async validateAndTouch(sessionId: string, adminUserId: string): Promise<void> {
    const session = await this.sessionRepository.findOne({ where: { id: sessionId, adminUserId } });
    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException("Admin session has expired or been revoked");
    }
    const now = new Date();
    if (!session.lastActivityAt || now.getTime() - session.lastActivityAt.getTime() >= 60_000) {
      session.lastActivityAt = now;
      await Promise.all([
        this.sessionRepository.save(session),
        this.adminUserRepository.update(adminUserId, { lastActivityAt: now }),
      ]);
    }
  }

  async listForAdmin(adminUserId: string) {
    return this.sessionRepository.find({ where: { adminUserId }, order: { createdAt: "DESC" }, take: 100 });
  }

  async revokeSession(sessionId: string, adminUserId: string, revokedByAdminUserId: string, reason: string) {
    const session = await this.sessionRepository.findOne({ where: { id: sessionId, adminUserId } });
    if (!session) throw new NotFoundException("Admin session not found");
    if (!session.revokedAt) {
      session.revokedAt = new Date();
      session.revokedByAdminUserId = revokedByAdminUserId;
      session.revocationReason = reason;
      await this.sessionRepository.save(session);
    }
    return session;
  }

  async revokeOthers(adminUserId: string, currentSessionId: string | undefined, revokedByAdminUserId: string, reason: string) {
    const sessions = await this.listForAdmin(adminUserId);
    const active = sessions.filter((session) => !session.revokedAt && session.id !== currentSessionId && session.expiresAt.getTime() > Date.now());
    await Promise.all(active.map((session) => this.revokeSession(session.id, adminUserId, revokedByAdminUserId, reason)));
    return active.length;
  }

  async revokeAll(adminUserId: string, revokedByAdminUserId: string, reason: string) {
    return this.revokeOthers(adminUserId, undefined, revokedByAdminUserId, reason);
  }
}
