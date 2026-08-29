import { ForbiddenException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { Repository } from "typeorm";
import type { MailService } from "../../../common/services/mail.service";
import type { AdminAccessReview, AdminAuditLog, AdminBreakGlassGrant, AdminInvitation, AdminPermission, AdminRole, AdminUser } from "../../../entities";
import type { AdminAuditLogsService } from "../audit-logs/admin-audit-logs.service";
import type { AdminSessionRegistryService } from "./admin-session-registry.service";
import { AdminIamService } from "./admin-iam.service";

describe("AdminIamService security boundaries", () => {
  const adminUsers = { findOne: jest.fn(), save: jest.fn(), createQueryBuilder: jest.fn() };
  const roles = { find: jest.fn() };
  const noopRepository = {};
  const service = new AdminIamService(
    adminUsers as unknown as Repository<AdminUser>,
    roles as unknown as Repository<AdminRole>,
    noopRepository as Repository<AdminPermission>,
    noopRepository as Repository<AdminInvitation>,
    noopRepository as Repository<AdminAccessReview>,
    noopRepository as Repository<AdminBreakGlassGrant>,
    noopRepository as Repository<AdminAuditLog>,
    {} as AdminSessionRegistryService,
    {} as AdminAuditLogsService,
    {} as MailService,
    {} as ConfigService,
  );

  beforeEach(() => jest.clearAllMocks());

  it("prevents an administrator from assigning permissions they do not hold", async () => {
    adminUsers.findOne.mockResolvedValue({ id: "target", roles: [{ id: "role-read", key: "reader", permissions: [{ key: "admins.read" }] }] });
    roles.find.mockResolvedValue([{ id: "role-manage", key: "manager", permissions: [{ key: "admins.manage" }] }]);
    await expect(service.updateRoles("target", ["role-manage"], { id: "actor", email: "actor@example.com", fullName: "Actor", status: "active", roleKeys: ["reader"], permissionKeys: ["admins.read"] })).rejects.toBeInstanceOf(ForbiddenException);
    expect(adminUsers.save).not.toHaveBeenCalled();
  });

  it("prevents emergency access from being activated for another administrator", async () => {
    await expect(service.activateBreakGlass("target", { reason: "Production incident response", durationMinutes: 30 }, { id: "actor", email: "actor@example.com", fullName: "Actor", status: "active", roleKeys: [], permissionKeys: ["admins.break_glass"] })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("prevents suspending or deactivating the last active super administrator", async () => {
    adminUsers.findOne.mockResolvedValue({ id: "target", roles: [{ key: "super-admin" }], status: "active" });
    const qb = { innerJoin: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), getCount: jest.fn().mockResolvedValue(1) };
    adminUsers.createQueryBuilder.mockReturnValue(qb);
    await expect(service.setStatus("target", "inactive", "off-boarding", { id: "actor", email: "actor@example.com", fullName: "Actor", status: "active", roleKeys: ["super-admin"], permissionKeys: ["admins.manage"] })).rejects.toBeInstanceOf(ForbiddenException);
    expect(adminUsers.save).not.toHaveBeenCalled();
  });
});
