import {
  Column,
  CreateDateColumn,
  Entity,
  JoinTable,
  ManyToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from "typeorm";
import { AdminPermission } from "./admin-permission.entity";

@Entity("admin_roles")
@Unique(["key"])
export class AdminRole {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  key!: string;

  @Column()
  name!: string;

  @Column({ type: "text", nullable: true })
  description?: string | null;

  @Column({ default: true })
  isSystem!: boolean;

  @ManyToMany(() => AdminPermission, { eager: true })
  @JoinTable({
    name: "admin_role_permissions",
    joinColumn: { name: "roleId", referencedColumnName: "id" },
    inverseJoinColumn: { name: "permissionId", referencedColumnName: "id" },
  })
  permissions!: AdminPermission[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
