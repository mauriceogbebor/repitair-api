import { Column, CreateDateColumn, Entity, PrimaryColumn } from "typeorm";

@Entity("upload_ownership")
export class UploadOwnership {
  @PrimaryColumn({ type: "varchar", length: 100 })
  key!: string;

  @Column({ type: "uuid" })
  userId!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
