import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

export type AdminAccessReviewOutcome = "approved" | "revoked" | "postponed";

@Entity("admin_access_reviews")
@Index(["adminUserId", "createdAt"])
export class AdminAccessReview {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column("uuid")
  adminUserId!: string;

  @Column("uuid")
  reviewerAdminUserId!: string;

  @Column({ type: "varchar" })
  outcome!: AdminAccessReviewOutcome;

  @Column({ type: "text" })
  rationale!: string;

  @Column({ type: "timestamptz" })
  dueAt!: Date;

  @Column({ type: "timestamptz", nullable: true })
  nextReviewAt?: Date | null;

  @CreateDateColumn()
  createdAt!: Date;
}
