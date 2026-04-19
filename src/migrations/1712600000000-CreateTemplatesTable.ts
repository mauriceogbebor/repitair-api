import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateTemplatesTable1712600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "templates" (
        "id" varchar PRIMARY KEY,
        "name" varchar NOT NULL,
        "style" varchar NOT NULL,
        "category" varchar NOT NULL DEFAULT 'All',
        "premium" boolean NOT NULL DEFAULT false,
        "animated" boolean NOT NULL DEFAULT false,
        "sortOrder" int NOT NULL DEFAULT 0
      )
    `);

    // Seed the 10 MVP templates (matching mobile app)
    await queryRunner.query(`
      INSERT INTO "templates" ("id", "name", "style", "category", "premium", "animated", "sortOrder") VALUES
        ('sunrise', 'Sunrise', 'Sunrise', 'Aesthetic', false, false, 1),
        ('cyber', 'Cyber', 'Ocean', 'Bold', false, false, 2),
        ('mono', 'Mono', 'Mono', 'Minimal', false, false, 3),
        ('neon-pulse', 'Neon Pulse', 'Ocean', 'Bold', false, false, 4),
        ('vinyl', 'Vinyl', 'Vinyl', 'Retro', false, false, 5),
        ('midnight', 'Midnight', 'Mono', 'Minimal', false, false, 6),
        ('polaroid', 'Polaroid', 'Polaroid', 'Aesthetic', false, false, 7),
        ('magazine', 'Magazine', 'Magazine', 'Bold', false, false, 8),
        ('dreamy', 'Dreamy', 'Story', 'Soft', false, false, 9),
        ('pulse-video', 'Pulse', 'Blush', 'Animated', false, true, 10)
      ON CONFLICT ("id") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "templates"`);
  }
}
