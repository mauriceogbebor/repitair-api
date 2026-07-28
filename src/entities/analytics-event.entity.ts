import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/**
 * Append-only analytics event log. Dashboards and aggregates must be derived
 * from these rows (real events), never fabricated from transactional tables.
 */
@Entity("analytics_events")
@Index(["name", "occurredAt"])
@Index(["occurredAt"])
export class AnalyticsEvent {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar" })
  name!: string;

  @Column({ type: "uuid", nullable: true })
  userId?: string | null;

  @Column({ type: "jsonb", nullable: true })
  properties?: Record<string, unknown> | null;

  @Column({ type: "varchar", default: "backend" })
  source!: string;

  @Column({ type: "timestamptz" })
  occurredAt!: Date;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
