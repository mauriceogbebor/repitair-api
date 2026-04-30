import { MigrationInterface, QueryRunner } from "typeorm";

export class FixTemplateStyles1713800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Give each template its own unique style so they get distinct layout configs

    // Cyber was using "Ocean" style — give it its own "Cyber" style
    await queryRunner.query(`
      UPDATE "templates"
      SET "style" = 'Cyber'
      WHERE "id" = 'cyber'
    `);

    // Neon Pulse was using "Ocean" style — give it "Neon Pulse"
    await queryRunner.query(`
      UPDATE "templates"
      SET "style" = 'Neon Pulse'
      WHERE "id" = 'neon-pulse'
    `);

    // Midnight was using "Mono" style — give it "Midnight"
    await queryRunner.query(`
      UPDATE "templates"
      SET "style" = 'Midnight'
      WHERE "id" = 'midnight'
    `);

    // Pulse-video was using "Blush" style — give it "Pulse"
    await queryRunner.query(`
      UPDATE "templates"
      SET "style" = 'Pulse'
      WHERE "id" = 'pulse-video'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "templates" SET "style" = 'Ocean' WHERE "id" = 'cyber'
    `);
    await queryRunner.query(`
      UPDATE "templates" SET "style" = 'Ocean' WHERE "id" = 'neon-pulse'
    `);
    await queryRunner.query(`
      UPDATE "templates" SET "style" = 'Mono' WHERE "id" = 'midnight'
    `);
    await queryRunner.query(`
      UPDATE "templates" SET "style" = 'Blush' WHERE "id" = 'pulse-video'
    `);
  }
}
