import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

export type PlatformWorkerState = "running" | "draining";

/**
 * Durable worker presence. A separate worker cannot be monitored from API
 * process memory, so each worker refreshes one small row while it is alive.
 */
@Entity("platform_worker_heartbeats")
@Index(["heartbeatAt"])
export class PlatformWorkerHeartbeat {
  @PrimaryColumn({ type: "varchar", length: 80 })
  id!: string;

  @Column({ type: "varchar", length: 20, default: "running" })
  state!: PlatformWorkerState;

  @Column({ type: "jsonb", default: () => "'[]'::jsonb" })
  queues!: string[];

  @Column({ type: "varchar", nullable: true })
  environment?: string | null;

  @Column({ type: "varchar", nullable: true })
  revision?: string | null;

  @Column({ type: "varchar", nullable: true })
  provider?: string | null;

  @Column({ type: "varchar", nullable: true })
  storageProvider?: string | null;

  @Column({ type: "uuid", nullable: true })
  currentJobId?: string | null;

  @Column({ type: "uuid", nullable: true })
  lastClaimedJobId?: string | null;

  @Column({ type: "timestamptz", nullable: true })
  lastClaimedAt?: Date | null;

  @Column({ type: "uuid", nullable: true })
  lastCompletedJobId?: string | null;

  @Column({ type: "timestamptz", nullable: true })
  lastCompletedAt?: Date | null;

  @Column({ type: "uuid", nullable: true })
  lastFailedJobId?: string | null;

  @Column({ type: "timestamptz", nullable: true })
  lastFailedAt?: Date | null;

  @Column({ type: "varchar", nullable: true })
  lastErrorCode?: string | null;

  @Column({ type: "timestamptz" })
  startedAt!: Date;

  @Column({ type: "timestamptz" })
  heartbeatAt!: Date;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
