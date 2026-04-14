import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from "typeorm";
import { User } from "./user.entity";

@Entity("repits")
export class Repit {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  userId!: string;

  @ManyToOne(() => User, (user) => user.repits, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user!: User;

  @Column({ default: "Untitled Repitair" })
  title!: string;

  @Column({ nullable: true })
  artist?: string;

  @Column({ default: "draft" })
  status!: string;

  @Column({ default: "spotify" })
  platform!: string;

  @Column()
  templateId!: string;

  @Column({ default: "" })
  songLink!: string;

  @Column({ nullable: true })
  backgroundPhotoUrl?: string;

  @CreateDateColumn()
  createdAt!: Date;
}
