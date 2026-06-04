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

  /** Layout variant hint for client rendering (e.g. "classic", "neon", "bold") */
  @Column({ default: "classic" })
  layoutVariant!: string;

  /** Player widget variant hint (e.g. "default", "playlist", "scatteredCards") */
  @Column({ default: "default" })
  playerVariant!: string;

  /** Suggested overlay opacity for the photo layer (0–1) */
  @Column({ type: "real", default: 0.3 })
  overlayOpacity!: number;
}
