import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from "typeorm";

@Entity("contact_submissions")
export class ContactSubmission {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  name!: string;

  @Column()
  email!: string;

  @Column()
  subject!: string;

  @Column("text")
  message!: string;

  @Column({ default: false })
  emailSent!: boolean;

  @CreateDateColumn()
  createdAt!: Date;
}
