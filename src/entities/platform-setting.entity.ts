import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

export type UpdatePolicy = "optional" | "recommended" | "mandatory";
export type IncidentSeverity = "info" | "warning" | "critical";

export interface MaintenanceState {
  enabled: boolean;
  title?: string | null;
  message?: string | null;
  estimatedCompletion?: string | null;
  supportLink?: string | null;
}

export interface IncidentBanner {
  title: string;
  message: string;
  severity: IncidentSeverity;
  startsAt?: string | null;
  expiresAt?: string | null;
}

/**
 * Singleton row (id = "singleton") holding operational platform configuration
 * that the mobile app consumes: minimum supported versions, maintenance mode,
 * and an incident banner. Structured fields are stored as jsonb so the shape can
 * evolve without a schema migration.
 */
@Entity("platform_settings")
export class PlatformSetting {
  @PrimaryColumn({ type: "varchar", default: "singleton" })
  id!: string;

  @Column({ type: "varchar", nullable: true })
  minIosVersion?: string | null;

  @Column({ type: "varchar", nullable: true })
  minAndroidVersion?: string | null;

  @Column({ type: "varchar", default: "optional" })
  updatePolicy!: UpdatePolicy;

  @Column({ type: "jsonb", nullable: true })
  maintenance?: MaintenanceState | null;

  @Column({ type: "jsonb", nullable: true })
  incidentBanner?: IncidentBanner | null;

  @Column({ type: "varchar", nullable: true })
  updatedByAdminEmail?: string | null;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
