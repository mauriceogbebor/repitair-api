import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity("templates")
export class Template {
  @PrimaryColumn()
  id!: string;

  @Column()
  name!: string;

  @Column()
  style!: string;

  @Column({ default: "All" })
  category!: string;

  @Column({ default: false })
  premium!: boolean;

  @Column({ default: false })
  animated!: boolean;

  @Column({ type: "int", default: 0 })
  sortOrder!: number;
}
