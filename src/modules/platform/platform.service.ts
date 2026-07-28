import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { FeatureFlag } from "../../entities/feature-flag.entity";
import {
  IncidentBanner,
  MaintenanceState,
  PlatformSetting,
  UpdatePolicy,
} from "../../entities/platform-setting.entity";

const SINGLETON_ID = "singleton";

/**
 * Canonical feature flags. `enabled` here is the DEFAULT used when no DB row
 * exists. Moderation/reports/publishing default OFF — their backend exists but
 * the Release-1 consumer product does not use them yet (see Alignment Review).
 */
export const DEFAULT_FEATURE_FLAGS: Record<string, { enabled: boolean; description: string; public: boolean }> = {
  spotlight: { enabled: true, description: "Spotlight promotional placements", public: true },
  push_notifications: { enabled: true, description: "Push notification delivery", public: true },
  new_templates: { enabled: true, description: "Expose newly published templates", public: true },
  experimental_features: { enabled: false, description: "Experimental consumer features", public: true },
  moderation: { enabled: false, description: "Trust & Safety moderation console (Release 2)", public: false },
  reports: { enabled: false, description: "Content reports queue (Release 2)", public: false },
  publishing: { enabled: false, description: "Public Repit publishing (Release 2)", public: true },
};

export interface HealthComponent {
  status: "operational" | "unavailable" | "degraded";
  detail: string;
}

@Injectable()
export class PlatformService {
  constructor(
    @InjectRepository(FeatureFlag)
    private readonly flagRepo: Repository<FeatureFlag>,
    @InjectRepository(PlatformSetting)
    private readonly settingRepo: Repository<PlatformSetting>,
    private readonly dataSource: DataSource,
  ) {}

  // ── Feature flags ───────────────────────────────────────────────────────
  async getFlags(): Promise<Array<{ key: string; enabled: boolean; description: string; isDefault: boolean }>> {
    const overrides = new Map((await this.flagRepo.find()).map((f) => [f.key, f]));
    return Object.entries(DEFAULT_FEATURE_FLAGS).map(([key, def]) => {
      const override = overrides.get(key);
      return {
        key,
        enabled: override ? override.enabled : def.enabled,
        description: override?.description ?? def.description,
        isDefault: !override,
      };
    });
  }

  async isEnabled(key: string): Promise<boolean> {
    const override = await this.flagRepo.findOne({ where: { key } });
    if (override) return override.enabled;
    return DEFAULT_FEATURE_FLAGS[key]?.enabled ?? false;
  }

  async setFlag(key: string, enabled: boolean, adminEmail?: string | null): Promise<FeatureFlag> {
    const existing = await this.flagRepo.findOne({ where: { key } });
    const flag = existing ?? this.flagRepo.create({ key, description: DEFAULT_FEATURE_FLAGS[key]?.description ?? null });
    flag.enabled = enabled;
    flag.updatedByAdminEmail = adminEmail ?? null;
    return this.flagRepo.save(flag);
  }

  // ── Platform settings ───────────────────────────────────────────────────
  async getSettings(): Promise<PlatformSetting> {
    let setting = await this.settingRepo.findOne({ where: { id: SINGLETON_ID } });
    if (!setting) {
      setting = this.settingRepo.create({ id: SINGLETON_ID, updatePolicy: "optional" });
      setting = await this.settingRepo.save(setting);
    }
    return setting;
  }

  async updateVersions(
    dto: { minIosVersion?: string | null; minAndroidVersion?: string | null; updatePolicy?: UpdatePolicy },
    adminEmail?: string | null,
  ): Promise<PlatformSetting> {
    const setting = await this.getSettings();
    if (dto.minIosVersion !== undefined) setting.minIosVersion = dto.minIosVersion;
    if (dto.minAndroidVersion !== undefined) setting.minAndroidVersion = dto.minAndroidVersion;
    if (dto.updatePolicy !== undefined) setting.updatePolicy = dto.updatePolicy;
    setting.updatedByAdminEmail = adminEmail ?? null;
    return this.settingRepo.save(setting);
  }

  async setMaintenance(state: MaintenanceState, adminEmail?: string | null): Promise<PlatformSetting> {
    const setting = await this.getSettings();
    setting.maintenance = state;
    setting.updatedByAdminEmail = adminEmail ?? null;
    return this.settingRepo.save(setting);
  }

  async setIncident(banner: IncidentBanner | null, adminEmail?: string | null): Promise<PlatformSetting> {
    const setting = await this.getSettings();
    setting.incidentBanner = banner;
    setting.updatedByAdminEmail = adminEmail ?? null;
    return this.settingRepo.save(setting);
  }

  // ── Public consumer config ──────────────────────────────────────────────
  async getPublicConfig() {
    const [setting, flags] = await Promise.all([this.getSettings(), this.getFlags()]);
    const now = Date.now();
    const incident = setting.incidentBanner;
    const incidentActive =
      incident &&
      (!incident.startsAt || new Date(incident.startsAt).getTime() <= now) &&
      (!incident.expiresAt || new Date(incident.expiresAt).getTime() >= now);

    return {
      minVersions: {
        ios: setting.minIosVersion ?? null,
        android: setting.minAndroidVersion ?? null,
        updatePolicy: setting.updatePolicy,
      },
      maintenance: setting.maintenance?.enabled ? setting.maintenance : { enabled: false },
      incidentBanner: incidentActive ? incident : null,
      featureFlags: Object.fromEntries(
        flags
          .filter((f) => DEFAULT_FEATURE_FLAGS[f.key]?.public)
          .map((f) => [f.key, f.enabled]),
      ),
    };
  }

  // ── Read-only operational health (honest) ───────────────────────────────
  async getHealth(): Promise<Record<string, HealthComponent>> {
    const database = await this.checkDatabase();
    // We do not yet run monitoring for these providers, so we report honestly.
    const unavailable: HealthComponent = { status: "unavailable", detail: "No monitoring configured" };
    return {
      api: { status: "operational", detail: "Serving this request" },
      database,
      storage: unavailable,
      pushProvider: unavailable,
      emailProvider: unavailable,
      backgroundWorkers: unavailable,
    };
  }

  private async checkDatabase(): Promise<HealthComponent> {
    try {
      await this.dataSource.query("SELECT 1");
      return { status: "operational", detail: "Connection healthy" };
    } catch (err) {
      return { status: "unavailable", detail: (err as Error).message };
    }
  }
}
