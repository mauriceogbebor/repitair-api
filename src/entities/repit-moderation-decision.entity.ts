import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

export type RepitModerationAction = "dismiss" | "archive" | "remove" | "escalate" | "forward_support";

@Entity("repit_moderation_decisions")
@Index(["repitId", "createdAt"])
@Index(["idempotencyKey"], { unique: true })
export class RepitModerationDecision {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  repitId!: string;

  @Column({ type: "uuid", nullable: true })
  reportId?: string | null;

  @Column({ type: "varchar" })
  action!: RepitModerationAction;

  @Column({ type: "text" })
  reason!: string;

  @Column({ type: "varchar" })
  policyKey!: string;

  @Column({ type: "int" })
  policyVersion!: number;

  @Column({ type: "varchar" })
  policyCategory!: string;

  @Column({ type: "varchar" })
  severity!: string;

  @Column({ type: "varchar" })
  previousStatus!: string;

  @Column({ type: "varchar" })
  resultingStatus!: string;

  @Column({ type: "varchar", nullable: true })
  idempotencyKey?: string | null;

  @Column({ type: "uuid", nullable: true })
  actorAdminUserId?: string | null;

  @Column({ type: "varchar", nullable: true })
  actorAdminEmail?: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
