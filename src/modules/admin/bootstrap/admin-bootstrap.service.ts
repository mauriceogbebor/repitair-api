import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import * as bcrypt from "bcryptjs";
import { Repository } from "typeorm";
import { AdminPermission, AdminRole, AdminUser } from "../../../entities";
import { ADMIN_PERMISSION_DEFINITIONS, ADMIN_ROLE_DEFINITIONS } from "../admin.constants";

@Injectable()
export class AdminBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(AdminBootstrapService.name);

  constructor(
    @InjectRepository(AdminPermission)
    private readonly permissionRepository: Repository<AdminPermission>,
    @InjectRepository(AdminRole)
    private readonly roleRepository: Repository<AdminRole>,
    @InjectRepository(AdminUser)
    private readonly userRepository: Repository<AdminUser>,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.REPITAIR_PROCESS_ROLE === "worker") return;
    await this.seedPermissions();
    await this.seedRoles();
    await this.ensureBootstrapAdmin();
  }

  private async seedPermissions(): Promise<void> {
    const existing = await this.permissionRepository.find();
    const existingByKey = new Map(existing.map((permission) => [permission.key, permission]));

    for (const definition of ADMIN_PERMISSION_DEFINITIONS) {
      const existingPermission = existingByKey.get(definition.key);
      if (existingPermission) {
        existingPermission.module = definition.module;
        existingPermission.description = definition.description;
        await this.permissionRepository.save(existingPermission);
        continue;
      }

      await this.permissionRepository.save(this.permissionRepository.create(definition));
    }
  }

  private async seedRoles(): Promise<void> {
    const permissions = await this.permissionRepository.find();
    const permissionByKey = new Map(permissions.map((permission) => [permission.key, permission]));

    for (const roleDefinition of ADMIN_ROLE_DEFINITIONS) {
      const existingRole = await this.roleRepository.findOne({
        where: { key: roleDefinition.key },
        relations: { permissions: true },
      });

      const resolvedPermissions = roleDefinition.permissions
        .map((permissionKey) => permissionByKey.get(permissionKey))
        .filter((permission): permission is AdminPermission => Boolean(permission));

      const role = existingRole ?? this.roleRepository.create({ key: roleDefinition.key });
      role.name = roleDefinition.name;
      role.description = roleDefinition.description;
      role.isSystem = true;
      role.permissions = resolvedPermissions;
      await this.roleRepository.save(role);
    }
  }

  private async ensureBootstrapAdmin(): Promise<void> {
    const email = this.configService.get<string>("ADMIN_BOOTSTRAP_EMAIL");
    const password = this.configService.get<string>("ADMIN_BOOTSTRAP_PASSWORD");
    const fullName =
      this.configService.get<string>("ADMIN_BOOTSTRAP_FULL_NAME") ?? "Repitair Super Admin";
    const mfaSecret = this.configService.get<string>("ADMIN_BOOTSTRAP_MFA_SECRET");

    if (!email || !password || !mfaSecret) {
      this.logger.warn(
        "Admin bootstrap credentials are incomplete. Set ADMIN_BOOTSTRAP_EMAIL, ADMIN_BOOTSTRAP_PASSWORD, and ADMIN_BOOTSTRAP_MFA_SECRET to seed the first admin user.",
      );
      return;
    }

    const superAdminRole = await this.roleRepository.findOne({
      where: { key: "super-admin" },
      relations: { permissions: true },
    });

    if (!superAdminRole) {
      this.logger.error("Super Admin role is missing; skipping bootstrap admin creation.");
      return;
    }

    const existingUser = await this.userRepository.findOne({
      where: { email },
      relations: { roles: true },
    });

    if (existingUser) {
      const hasSuperAdminRole = existingUser.roles.some((role) => role.key === "super-admin");
      if (!hasSuperAdminRole) {
        existingUser.roles = [...existingUser.roles, superAdminRole];
        await this.userRepository.save(existingUser);
        this.logger.log(`Added super-admin role to existing bootstrap admin ${email}.`);
      }
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const adminUser = this.userRepository.create({
      fullName,
      email,
      passwordHash,
      status: "active",
      mfaEnabled: true,
      mfaSecret,
      roles: [superAdminRole],
    });

    await this.userRepository.save(adminUser);
    this.logger.log(`Created bootstrap admin user ${email}.`);
  }
}
