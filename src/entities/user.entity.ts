import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany } from "typeorm";
import { Repit } from "./repit.entity";
import { PushToken } from "./push-token.entity";

@Entity("users")
export class User {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  fullName!: string;

  @Column({ unique: true })
  email!: string;

  @Column({ default: "" })
  country!: string;

  @Column()
  passwordHash!: string;

  // Native Postgres text[] instead of simple-array so individual platform
  // strings can contain commas, and values remain queryable.
  @Column("text", { array: true, default: () => "'{}'" })
  connectedPlatforms!: string[];

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ nullable: true })
  resetCode?: string;

  @Column({ type: "timestamp", nullable: true })
  resetCodeExpiresAt?: Date;

  @OneToMany(() => Repit, (repit) => repit.user)
  repits!: Repit[];

  @OneToMany(() => PushToken, (token) => token.user)
  pushTokens!: PushToken[];
}
